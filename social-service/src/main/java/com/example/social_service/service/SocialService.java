package com.example.social_service.service;

import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.social_service.client.TaskClient;
import com.example.social_service.client.TaskInfo;
import com.example.social_service.client.UserClient;
import com.example.social_service.client.UserInfo;
import com.example.social_service.dto.Dtos.Audience;
import com.example.social_service.dto.Dtos.DiscoverEntry;
import com.example.social_service.dto.Dtos.OpenTask;
import com.example.social_service.dto.Dtos.Person;
import com.example.social_service.dto.Dtos.Relationship;
import com.example.social_service.dto.Dtos.RequestEntry;
import com.example.social_service.dto.Dtos.Requests;
import com.example.social_service.dto.Dtos.SharedTask;
import com.example.social_service.dto.Dtos.Space;
import com.example.social_service.dto.Dtos.ViewTasksEntry;
import com.example.social_service.dto.Dtos.Viewer;
import com.example.social_service.exception.ApiException;
import com.example.social_service.repository.SocialRepository;
import com.example.social_service.repository.SocialRepository.AccessRequest;
import com.example.social_service.repository.SocialRepository.Link;

/*
 * Visibility rules
 *   only_me  - the owner only
 *   trusted  - also users on the owner's Your Task Viewers list (All Trusted), or only the
 *              Hand-picked ones among them when the task has an audience
 *   open     - every logged-in user; an Unlisted owner is shown as "User is Unlisted"
 * Unlisted users are hidden from Discover, their Space opens only for themselves, and they cannot receive requests.
 * Admins get no extra access here: they are treated like every other user.
 */
@Service
public class SocialService {

    public record Caller(String studentId) {
    }

    private static final List<String> ALL = List.of("only_me", "trusted", "open");
    private static final List<String> TRUSTED_AND_OPEN = List.of("trusted", "open");
    private static final List<String> OPEN = List.of("open");
    private static final int OPEN_FEED_LIMIT = 100;
    private static final int MAX_AUDIENCE = 200;

    private final SocialRepository repo;
    private final UserClient users;
    private final TaskClient tasks;

    public SocialService(SocialRepository repo, UserClient users, TaskClient tasks) {
        this.repo = repo;
        this.users = users;
        this.tasks = tasks;
    }

    // ---- settings ----

    public boolean isListed(Caller caller) {
        return repo.isListed(caller.studentId());
    }

    public boolean setListed(Caller caller, boolean listed) {
        repo.setListed(caller.studentId(), listed);
        return listed;
    }

    // ---- Discover ----

    public List<DiscoverEntry> discover(Caller caller) {
        Set<String> listed = repo.listedIds();
        listed.remove(caller.studentId());
        Relations rel = relations(caller);

        return users.byIds(listed).values().stream()
                .filter(u -> u.username() != null)
                .sorted((a, b) -> a.username().compareTo(b.username()))
                .map(u -> new DiscoverEntry(person(u, true), rel.with(u.studentId())))
                .toList();
    }

    public List<OpenTask> openTasks(Caller caller) {
        List<TaskInfo> open = tasks.openTasks(caller.studentId(), OPEN_FEED_LIMIT);
        Map<String, UserInfo> owners = users.byIds(open.stream().map(TaskInfo::studentId).collect(Collectors.toSet()));
        Set<String> listed = repo.listedIds();

        return open.stream()
                .map(t -> new OpenTask(SharedTask.of(t),
                        visiblePerson(owners.get(t.studentId()), listed.contains(t.studentId()))))
                .toList();
    }

    // ---- Space ----

    public Space space(Caller caller, String username) {
        UserInfo target = requireUser(username);
        boolean self = target.studentId().equals(caller.studentId());
        boolean listed = repo.isListed(target.studentId());

        if (!listed && !self) {
            throw new ApiException(HttpStatus.NOT_FOUND, "User is Unlisted");
        }

        Relationship relationship = relations(caller).with(target.studentId());
        List<String> visibilities = self ? ALL : relationship.addedMe() ? TRUSTED_AND_OPEN : OPEN;
        List<TaskInfo> found = tasks.tasks(List.of(target.studentId()), visibilities);
        List<SharedTask> shared = (self ? found : visibleTo(caller, found)).stream()
                .map(SharedTask::of)
                .toList();

        return new Space(person(target, listed), self, relationship, shared);
    }

    // ---- Your Task Viewers ----

    public List<Viewer> viewers(Caller caller) {
        List<Link> links = repo.viewersOf(caller.studentId());
        Map<String, UserInfo> info = users.byIds(ids(links));
        Set<String> listed = repo.listedIds();

        // the owner chose these people, so their identity is always shown to the owner
        return links.stream()
                .filter(l -> info.containsKey(l.studentId()))
                .map(l -> new Viewer(person(info.get(l.studentId()), listed.contains(l.studentId())), l.createdAt()))
                .toList();
    }

    @Transactional
    public void addViewer(Caller caller, String username) {
        UserInfo target = requireUser(username);
        requireNotSelf(caller, target);
        if (!repo.isListed(target.studentId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "User is Unlisted");
        }
        repo.addViewer(caller.studentId(), target.studentId());
        // a pending request from them is now fulfilled
        repo.requestsTo(caller.studentId()).stream()
                .filter(r -> r.requesterId().equals(target.studentId()))
                .forEach(r -> repo.deleteRequest(r.id()));
    }

    public void removeViewer(Caller caller, String username) {
        UserInfo target = requireUser(username);
        if (!repo.removeViewer(caller.studentId(), target.studentId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Not one of your task viewers");
        }
    }

    // ---- View Tasks (owners who added me) ----

    public List<ViewTasksEntry> viewTasks(Caller caller) {
        List<Link> links = repo.ownersWhoAdded(caller.studentId());
        if (links.isEmpty()) {
            return List.of();
        }
        Map<String, UserInfo> info = users.byIds(ids(links));
        Set<String> listed = repo.listedIds();
        Map<String, List<SharedTask>> byOwner = visibleTo(caller, tasks.tasks(ids(links), TRUSTED_AND_OPEN)).stream()
                .collect(Collectors.groupingBy(TaskInfo::studentId,
                        Collectors.mapping(SharedTask::of, Collectors.toList())));

        return links.stream()
                .filter(l -> info.containsKey(l.studentId()))
                .map(l -> new ViewTasksEntry(
                        visiblePerson(info.get(l.studentId()), listed.contains(l.studentId())),
                        l.createdAt(),
                        byOwner.getOrDefault(l.studentId(), List.of())))
                .toList();
    }

    // ---- Viewer Access Requests ----

    public Requests requests(Caller caller) {
        List<AccessRequest> incoming = repo.requestsTo(caller.studentId());
        List<AccessRequest> outgoing = repo.requestsFrom(caller.studentId());
        Map<String, UserInfo> info = users.byIds(Stream.concat(
                incoming.stream().map(AccessRequest::requesterId),
                outgoing.stream().map(AccessRequest::ownerId)).collect(Collectors.toSet()));
        Set<String> listed = repo.listedIds();

        // requesters reveal themselves by asking, so their identity is shown to the owner
        List<RequestEntry> in = incoming.stream()
                .filter(r -> info.containsKey(r.requesterId()))
                .map(r -> new RequestEntry(r.id(), person(info.get(r.requesterId()), listed.contains(r.requesterId())), r.createdAt()))
                .toList();
        List<RequestEntry> out = outgoing.stream()
                .filter(r -> info.containsKey(r.ownerId()))
                .map(r -> new RequestEntry(r.id(), visiblePerson(info.get(r.ownerId()), listed.contains(r.ownerId())), r.createdAt()))
                .toList();
        return new Requests(in, out);
    }

    public int sendRequest(Caller caller, String username) {
        UserInfo target = requireUser(username);
        requireNotSelf(caller, target);
        if (!repo.isListed(target.studentId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "User is Unlisted");
        }
        if (repo.isViewer(target.studentId(), caller.studentId())) {
            throw new ApiException(HttpStatus.CONFLICT, "You are already one of their task viewers");
        }
        return repo.createRequest(caller.studentId(), target.studentId())
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "Request already sent"));
    }

    @Transactional
    public void acceptRequest(Caller caller, int id) {
        AccessRequest request = requestAddressedTo(caller, id);
        repo.addViewer(caller.studentId(), request.requesterId());
        repo.deleteRequest(id);
    }

    public void declineRequest(Caller caller, int id) {
        repo.deleteRequest(requestAddressedTo(caller, id).id());
    }

    public void cancelRequest(Caller caller, int id) {
        AccessRequest request = repo.findRequest(id)
                .filter(r -> r.requesterId().equals(caller.studentId()))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Request not found"));
        repo.deleteRequest(request.id());
    }

    // ---- Hand-picked audiences of my Trusted tasks ----

    public List<Audience> audiences(Caller caller) {
        List<Integer> mine = tasks.tasks(List.of(caller.studentId()), ALL).stream().map(TaskInfo::id).toList();
        Map<Integer, Set<String>> picked = repo.audiences(mine);
        if (picked.isEmpty()) {
            return List.of();
        }
        Set<String> viewers = ids(repo.viewersOf(caller.studentId()));
        Map<String, UserInfo> info = users.byIds(viewers);
        Set<String> listed = repo.listedIds();

        // people who left Your Task Viewers no longer count
        return picked.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new Audience(e.getKey(), e.getValue().stream()
                        .filter(info::containsKey)
                        .map(id -> person(info.get(id), listed.contains(id)))
                        .sorted(Comparator.comparing(Person::username))
                        .toList()))
                .toList();
    }

    @Transactional
    public Audience setAudience(Caller caller, int taskId, List<String> usernames) {
        requireOwnTask(caller, taskId);
        if (usernames == null || usernames.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at least one person");
        }
        if (usernames.size() > MAX_AUDIENCE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at most " + MAX_AUDIENCE + " people");
        }

        Map<String, UserInfo> byUsername = users.byUsernames(usernames.stream().map(String::trim).toList()).stream()
                .collect(Collectors.toMap(u -> u.username().toLowerCase(), u -> u, (a, b) -> a));
        Set<String> viewers = ids(repo.viewersOf(caller.studentId()));
        Set<String> listed = repo.listedIds();
        Map<String, UserInfo> picked = new LinkedHashMap<>();
        for (String username : usernames) {
            UserInfo u = byUsername.get(username.trim().toLowerCase());
            if (u == null || !viewers.contains(u.studentId())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "@" + username.trim() + " is not one of your task viewers");
            }
            picked.put(u.studentId(), u);
        }

        repo.setAudience(taskId, picked.keySet());
        return new Audience(taskId, picked.values().stream()
                .map(u -> person(u, listed.contains(u.studentId())))
                .sorted(Comparator.comparing(Person::username))
                .toList());
    }

    // Back to All Trusted
    public void clearAudience(Caller caller, int taskId) {
        requireOwnTask(caller, taskId);
        repo.clearAudience(taskId);
    }

    // ---- helpers ----

    // Drops Hand-picked Trusted tasks the caller was not picked for
    private List<TaskInfo> visibleTo(Caller caller, List<TaskInfo> found) {
        List<Integer> trusted = found.stream().filter(t -> "trusted".equals(t.visibility())).map(TaskInfo::id).toList();
        Map<Integer, Set<String>> picked = repo.audiences(trusted);
        return found.stream()
                .filter(t -> !"trusted".equals(t.visibility()) || !picked.containsKey(t.id())
                        || picked.get(t.id()).contains(caller.studentId()))
                .toList();
    }

    private void requireOwnTask(Caller caller, int taskId) {
        boolean mine = tasks.tasks(List.of(caller.studentId()), ALL).stream().anyMatch(t -> t.id() == taskId);
        if (!mine) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Task not found");
        }
    }

    private AccessRequest requestAddressedTo(Caller caller, int id) {
        return repo.findRequest(id)
                .filter(r -> r.ownerId().equals(caller.studentId()))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Request not found"));
    }

    private UserInfo requireUser(String username) {
        UserInfo user = username == null || username.isBlank() ? null : users.byUsername(username.trim());
        if (user == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "User not found");
        }
        return user;
    }

    private static void requireNotSelf(Caller caller, UserInfo target) {
        if (target.studentId().equals(caller.studentId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "That is you");
        }
    }

    private static Person person(UserInfo u, boolean listed) {
        return new Person(u.username(), u.name(), listed);
    }

    // null renders as "User is Unlisted"
    private static Person visiblePerson(UserInfo u, boolean listed) {
        if (u == null || !listed) {
            return null;
        }
        return person(u, listed);
    }

    private static Set<String> ids(Collection<Link> links) {
        return links.stream().map(Link::studentId).collect(Collectors.toCollection(HashSet::new));
    }

    private Relations relations(Caller caller) {
        String me = caller.studentId();
        return new Relations(
                ids(repo.viewersOf(me)),
                ids(repo.ownersWhoAdded(me)),
                repo.requestsFrom(me).stream().collect(Collectors.toMap(AccessRequest::ownerId, AccessRequest::id)),
                repo.requestsTo(me).stream().collect(Collectors.toMap(AccessRequest::requesterId, AccessRequest::id)));
    }

    private record Relations(Set<String> myViewers, Set<String> addedMe,
            Map<String, Integer> sent, Map<String, Integer> received) {

        Relationship with(String other) {
            return new Relationship(myViewers.contains(other), addedMe.contains(other),
                    sent.get(other), received.get(other));
        }
    }
}
