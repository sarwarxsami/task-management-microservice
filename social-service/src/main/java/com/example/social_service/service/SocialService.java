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

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.example.social_service.client.TaskClient;
import com.example.social_service.client.TaskInfo;
import com.example.social_service.client.UserClient;
import com.example.social_service.client.UserInfo;
import com.example.social_service.dto.Dtos.Audience;
import com.example.social_service.dto.Dtos.AudienceBody;
import com.example.social_service.dto.Dtos.DiscoverEntry;
import com.example.social_service.dto.Dtos.GroupRef;
import com.example.social_service.dto.Dtos.GroupView;
import com.example.social_service.dto.Dtos.Groups;
import com.example.social_service.dto.Dtos.OpenTask;
import com.example.social_service.dto.Dtos.Person;
import com.example.social_service.dto.Dtos.Relationship;
import com.example.social_service.dto.Dtos.RequestEntry;
import com.example.social_service.dto.Dtos.Requests;
import com.example.social_service.dto.Dtos.SharedTask;
import com.example.social_service.dto.Dtos.Space;
import com.example.social_service.dto.Dtos.ViewTasksEntry;
import com.example.social_service.dto.Dtos.Viewer;
import com.example.social_service.dto.Dtos.WhoCanSee;
import com.example.social_service.dto.Dtos.WhoPerson;
import com.example.social_service.exception.ApiException;
import com.example.social_service.repository.SocialRepository;
import com.example.social_service.repository.SocialRepository.AccessRequest;
import com.example.social_service.repository.SocialRepository.Group;
import com.example.social_service.repository.SocialRepository.GroupMembership;
import com.example.social_service.repository.SocialRepository.Link;
import com.example.social_service.repository.SocialRepository.TaskAudience;

/*
 * Visibility rules
 *   only_me  - the owner only
 *   trusted  - also users on the owner's Your Task Viewers list (All Trusted), or only some of them:
 *              Hand-picked people, or members of chosen groups (Default = viewers in no group)
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
    private static final int MAX_GROUPS = 50;
    private static final int MAX_GROUP_NAME = 30;

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

    @Transactional
    public void removeViewer(Caller caller, String username) {
        UserInfo target = requireUser(username);
        if (!repo.removeViewer(caller.studentId(), target.studentId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Not one of your task viewers");
        }
        repo.removeFromAllGroups(caller.studentId(), target.studentId());
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

    // ---- Groups inside Your Task Viewers ----

    public Groups groups(Caller caller) {
        Viewers v = viewersWithGroups(caller);
        return new Groups(v.groups().stream().map(v::view).toList(), v.people(v.defaultIds()));
    }

    public GroupView createGroup(Caller caller, String name) {
        String clean = groupName(name);
        if (repo.countGroups(caller.studentId()) >= MAX_GROUPS) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "You can have at most " + MAX_GROUPS + " groups");
        }
        try {
            int id = repo.createGroup(caller.studentId(), clean);
            return new GroupView(id, clean, List.of());
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "You already have a group called " + clean);
        }
    }

    public GroupView renameGroup(Caller caller, int groupId, String name) {
        String clean = groupName(name);
        try {
            if (!repo.renameGroup(caller.studentId(), groupId, clean)) {
                throw new ApiException(HttpStatus.NOT_FOUND, "Group not found");
            }
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "You already have a group called " + clean);
        }
        Viewers v = viewersWithGroups(caller);
        return v.view(v.group(groupId));
    }

    // Tasks shared only with this group become visible to nobody (never All Trusted)
    public void deleteGroup(Caller caller, int groupId) {
        if (!repo.deleteGroup(caller.studentId(), groupId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Group not found");
        }
    }

    @Transactional
    public GroupView addGroupMembers(Caller caller, int groupId, List<String> usernames) {
        Group group = viewersWithGroups(caller).group(groupId);
        if (usernames == null || usernames.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at least one person");
        }
        repo.addGroupMembers(group.id(), requireMyViewers(caller, usernames).keySet());
        Viewers updated = viewersWithGroups(caller);
        return updated.view(updated.group(groupId));
    }

    public void removeGroupMember(Caller caller, int groupId, String username) {
        Group group = viewersWithGroups(caller).group(groupId);
        UserInfo target = requireUser(username);
        if (!repo.removeGroupMember(group.id(), target.studentId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Not in this group");
        }
    }

    // ---- Audiences of my Trusted tasks: All Trusted (none), Hand-picked or Groups ----

    public List<Audience> audiences(Caller caller) {
        List<Integer> mine = tasks.tasks(List.of(caller.studentId()), ALL).stream().map(TaskInfo::id).toList();
        Map<Integer, TaskAudience> found = repo.audiences(mine);
        if (found.isEmpty()) {
            return List.of();
        }
        Viewers v = viewersWithGroups(caller);
        return found.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> audience(e.getKey(), e.getValue(), v))
                .toList();
    }

    @Transactional
    public Audience setAudience(Caller caller, int taskId, AudienceBody body) {
        requireOwnTask(caller, taskId);
        String mode = body.mode() == null ? "picked" : body.mode();

        if ("picked".equals(mode)) {
            List<String> usernames = body.usernames();
            if (usernames == null || usernames.isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at least one person");
            }
            if (usernames.size() > MAX_AUDIENCE) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at most " + MAX_AUDIENCE + " people");
            }
            repo.setPickedAudience(taskId, requireMyViewers(caller, usernames).keySet());
        } else if ("groups".equals(mode)) {
            List<Integer> groupIds = body.groupIds() == null ? List.of() : body.groupIds();
            boolean includeDefault = Boolean.TRUE.equals(body.includeDefault());
            if (groupIds.isEmpty() && !includeDefault) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Pick at least one group");
            }
            Set<Integer> mine = repo.groupsOf(caller.studentId()).stream().map(Group::id).collect(Collectors.toSet());
            if (!mine.containsAll(groupIds)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Not one of your groups");
            }
            repo.setGroupAudience(taskId, new HashSet<>(groupIds), includeDefault);
        } else {
            throw new ApiException(HttpStatus.BAD_REQUEST, "mode must be picked or groups");
        }
        return audience(taskId, repo.audiences(List.of(taskId)).get(taskId), viewersWithGroups(caller));
    }

    // Back to All Trusted
    public void clearAudience(Caller caller, int taskId) {
        requireOwnTask(caller, taskId);
        repo.clearAudience(taskId);
    }

    public WhoCanSee whoCanSee(Caller caller, int taskId) {
        TaskInfo task = tasks.tasks(List.of(caller.studentId()), ALL).stream()
                .filter(t -> t.id() == taskId)
                .findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found"));
        if (!"trusted".equals(task.visibility())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only Trusted tasks have a viewer list");
        }
        Viewers v = viewersWithGroups(caller);
        TaskAudience a = repo.audiences(List.of(taskId)).get(taskId);

        if (a == null) {
            return new WhoCanSee("all", v.groups().stream().map(v::view).toList(), v.defaultPeople(), true);
        }
        if ("picked".equals(a.mode())) {
            Set<String> defaults = v.defaultIds();
            List<WhoPerson> people = a.people().stream()
                    .filter(id -> v.viewerIds().contains(id) && v.info().containsKey(id))
                    .map(id -> new WhoPerson(v.person(id), defaults.contains(id)))
                    .sorted(Comparator.comparing(w -> w.person().username()))
                    .toList();
            return new WhoCanSee("picked", List.of(), people, false);
        }
        List<GroupView> chosen = v.groups().stream().filter(g -> a.groupIds().contains(g.id())).map(v::view).toList();
        return new WhoCanSee("groups", chosen, a.includeDefault() ? v.defaultPeople() : List.of(), a.includeDefault());
    }

    // ---- helpers ----

    // Drops Hand-picked / Groups Trusted tasks the caller is not in the audience of
    private List<TaskInfo> visibleTo(Caller caller, List<TaskInfo> found) {
        List<Integer> trusted = found.stream().filter(t -> "trusted".equals(t.visibility())).map(TaskInfo::id).toList();
        Map<Integer, TaskAudience> audiences = repo.audiences(trusted);
        if (audiences.isEmpty()) {
            return found;
        }
        GroupMembership mine = repo.membershipOf(caller.studentId());
        return found.stream()
                .filter(t -> {
                    TaskAudience a = "trusted".equals(t.visibility()) ? audiences.get(t.id()) : null;
                    return a == null || allows(a, caller.studentId(), t.studentId(), mine);
                })
                .toList();
    }

    private static boolean allows(TaskAudience a, String viewerId, String ownerId, GroupMembership viewer) {
        if ("picked".equals(a.mode())) {
            return a.people().contains(viewerId);
        }
        return a.groupIds().stream().anyMatch(viewer.groupIds()::contains)
                || (a.includeDefault() && !viewer.groupedUnder().contains(ownerId));
    }

    private static Audience audience(int taskId, TaskAudience a, Viewers v) {
        List<GroupRef> groups = v.groups().stream()
                .filter(g -> a.groupIds().contains(g.id()))
                .map(g -> new GroupRef(g.id(), g.name()))
                .toList();
        return new Audience(taskId, a.mode(), v.people(a.people()), groups, a.includeDefault());
    }

    // usernames must all be on the caller's task viewers; returns studentId -> user, in the given order
    private Map<String, UserInfo> requireMyViewers(Caller caller, List<String> usernames) {
        Map<String, UserInfo> byUsername = users.byUsernames(usernames.stream().map(String::trim).toList()).stream()
                .collect(Collectors.toMap(u -> u.username().toLowerCase(), u -> u, (a, b) -> a));
        Set<String> viewers = ids(repo.viewersOf(caller.studentId()));
        Map<String, UserInfo> result = new LinkedHashMap<>();
        for (String username : usernames) {
            UserInfo u = byUsername.get(username.trim().toLowerCase());
            if (u == null || !viewers.contains(u.studentId())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "@" + username.trim() + " is not one of your task viewers");
            }
            result.put(u.studentId(), u);
        }
        return result;
    }

    private static String groupName(String name) {
        String clean = name == null ? "" : name.trim().replaceAll("\\s+", " ");
        if (clean.isEmpty() || clean.length() > MAX_GROUP_NAME) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Group name must be 1-" + MAX_GROUP_NAME + " characters");
        }
        if (clean.equalsIgnoreCase("Default")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Default is reserved for people in no group");
        }
        return clean;
    }

    // My task viewers with their names, my groups, and who is in Default
    private Viewers viewersWithGroups(Caller caller) {
        Set<String> viewerIds = ids(repo.viewersOf(caller.studentId()));
        return new Viewers(viewerIds, repo.groupsOf(caller.studentId()), users.byIds(viewerIds), repo.listedIds());
    }

    private record Viewers(Set<String> viewerIds, List<Group> groups, Map<String, UserInfo> info, Set<String> listed) {

        Group group(int id) {
            return groups.stream().filter(g -> g.id() == id).findFirst()
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Group not found"));
        }

        // viewers in no group
        Set<String> defaultIds() {
            Set<String> grouped = groups.stream().flatMap(g -> g.members().stream()).collect(Collectors.toSet());
            return viewerIds.stream().filter(id -> !grouped.contains(id)).collect(Collectors.toSet());
        }

        Person person(String id) {
            return SocialService.person(info.get(id), listed.contains(id));
        }

        // only people still on my task viewers, sorted by username
        List<Person> people(Collection<String> ids) {
            return ids.stream()
                    .filter(id -> viewerIds.contains(id) && info.containsKey(id))
                    .map(this::person)
                    .sorted(Comparator.comparing(Person::username))
                    .toList();
        }

        List<WhoPerson> defaultPeople() {
            return people(defaultIds()).stream().map(p -> new WhoPerson(p, true)).toList();
        }

        GroupView view(Group g) {
            return new GroupView(g.id(), g.name(), people(g.members()));
        }
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
