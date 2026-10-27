package com.example.social_service.dto;

import java.time.Instant;
import java.util.List;

import com.example.social_service.client.TaskInfo;

// Response and request bodies of the social-service API
public final class Dtos {

    private Dtos() {
    }

    // Public identity of a user; student IDs are never shared
    public record Person(String username, String name, boolean listed) {
    }

    // A task as seen by someone else: no owner identity inside
    public record SharedTask(int id, String title, String description, String deadline, String priority,
            String visibility, boolean completed, String completedAt, String createdAt, String updatedAt) {

        public static SharedTask of(TaskInfo t) {
            return new SharedTask(t.id(), t.title(), t.description(), t.deadline(), t.priority(),
                    t.visibility(), t.completed(), t.completedAt(), t.createdAt(), t.updatedAt());
        }
    }

    // How the current user relates to another user
    public record Relationship(
            boolean isMyTaskViewer,
            boolean addedMe,
            Integer requestSentId,
            Integer requestReceivedId) {
    }

    public record DiscoverEntry(Person person, Relationship relationship) {
    }

    public record Space(Person person, boolean self, Relationship relationship, List<SharedTask> tasks) {
    }

    // owner == null means "User is Unlisted"
    public record OpenTask(SharedTask task, Person owner) {
    }

    // owner == null means "User is Unlisted"
    public record ViewTasksEntry(Person owner, Instant since, List<SharedTask> tasks) {
    }

    public record Viewer(Person person, Instant since) {
    }

    // person == null means "User is Unlisted"
    public record RequestEntry(int id, Person person, Instant createdAt) {
    }

    public record Requests(List<RequestEntry> incoming, List<RequestEntry> outgoing) {
    }

    public record GroupRef(int id, String name) {
    }

    // A group inside Your Task Viewers; members are people still on the list
    public record GroupView(int id, String name, List<Person> members) {
    }

    // defaultMembers: viewers in no group
    public record Groups(List<GroupView> groups, List<Person> defaultMembers) {
    }

    public record GroupBody(String name) {
    }

    public record UsernamesBody(List<String> usernames) {
    }

    // Audience of one of my Trusted tasks: mode "picked" (people) or "groups" (groups, and Default when includeDefault)
    public record Audience(int taskId, String mode, List<Person> people, List<GroupRef> groups, boolean includeDefault) {
    }

    // mode defaults to "picked"
    public record AudienceBody(String mode, List<String> usernames, List<Integer> groupIds, Boolean includeDefault) {
    }

    public record WhoPerson(Person person, boolean inDefault) {
    }

    // Who can see one of my Trusted tasks. mode: "all", "picked" or "groups".
    // all: every group plus Default people; picked: the people; groups: the chosen groups plus Default people if chosen
    public record WhoCanSee(String mode, List<GroupView> groups, List<WhoPerson> people, boolean includeDefault) {
    }

    public record Settings(Boolean listed) {
    }

    public record UsernameBody(String username) {
    }
}
