package com.example.social_service;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.example.social_service.client.TaskClient;
import com.example.social_service.client.TaskInfo;
import com.example.social_service.client.UserClient;
import com.example.social_service.client.UserInfo;
import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

// Integration tests: need a Postgres with db/init.sql applied (DB_* env vars).
// user-service and task-service are replaced by in-memory fakes.
@SpringBootTest(properties = { "app.jwt.secret=" + SocialApiTests.SECRET,
        "app.internal.key=test-internal-key-that-is-at-least-32-chars" })
@AutoConfigureMockMvc
class SocialApiTests {

    static final String SECRET = "test-secret-that-is-at-least-32-characters";
    private static final String BASE = "/service/social-service";

    private static final List<UserInfo> USERS = List.of(
            new UserInfo("s-alice", "Alice", "alice", "user"),
            new UserInfo("s-bob", "Bob", "bob", "user"),
            new UserInfo("s-carol", "Carol", "carol", "user"),
            new UserInfo("s-admin", "Admin", "admin", "admin"));

    // ids are also inserted into the tasks table, which the audience tables reference
    private static final int ALICE_TRUSTED = 900002;
    private static final int CAROL_TRUSTED = 900004;
    private static final List<TaskInfo> TASKS = List.of(
            task(900001, "s-alice", "alice private", "only_me"),
            task(ALICE_TRUSTED, "s-alice", "alice trusted", "trusted"),
            task(900003, "s-alice", "alice open", "open"),
            task(CAROL_TRUSTED, "s-carol", "carol trusted", "trusted"),
            task(900005, "s-carol", "carol open", "open"));

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    @MockitoBean
    private UserClient userClient;

    @MockitoBean
    private TaskClient taskClient;

    private static TaskInfo task(int id, String owner, String title, String visibility) {
        return new TaskInfo(id, owner, title, null, null, "medium", visibility, false, null, null, null);
    }

    @BeforeEach
    void setUp() {
        cleanUp();
        for (UserInfo u : USERS) {
            jdbc.update("INSERT INTO users (name, student_id) VALUES (?, ?)", u.name(), u.studentId());
        }
        for (TaskInfo t : TASKS) {
            jdbc.update("INSERT INTO tasks (id, student_id, task, visibility) VALUES (?, ?, ?, ?)",
                    t.id(), t.studentId(), t.title(), t.visibility());
        }
        Map<String, UserInfo> byId = USERS.stream().collect(Collectors.toMap(UserInfo::studentId, Function.identity()));
        when(userClient.byIds(anyCollection())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return ids.stream().filter(byId::containsKey).collect(Collectors.toMap(id -> id, byId::get));
        });
        when(userClient.byUsernames(anyCollection())).thenAnswer(inv -> {
            Collection<String> names = inv.getArgument(0);
            return USERS.stream().filter(u -> names.stream().anyMatch(n -> n.equalsIgnoreCase(u.username()))).toList();
        });
        when(userClient.byUsername(anyString())).thenAnswer(inv -> USERS.stream()
                .filter(u -> u.username().equalsIgnoreCase(inv.getArgument(0))).findFirst().orElse(null));
        when(taskClient.tasks(anyCollection(), anyCollection())).thenAnswer(inv -> {
            Collection<String> owners = inv.getArgument(0);
            Collection<String> visibilities = inv.getArgument(1);
            return TASKS.stream()
                    .filter(t -> owners.isEmpty() || owners.contains(t.studentId()))
                    .filter(t -> visibilities.contains(t.visibility()))
                    .toList();
        });
        when(taskClient.openTasks(anyString(), anyInt())).thenAnswer(inv -> TASKS.stream()
                .filter(t -> t.visibility().equals("open") && !t.studentId().equals(inv.getArgument(0)))
                .limit((int) inv.getArgument(1))
                .toList());
    }

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM users WHERE student_id LIKE 's-%'");
    }

    private static String token(String studentId, String role) throws Exception {
        var claims = new JWTClaimsSet.Builder()
                .subject(studentId)
                .claim("role", role)
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .build();
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner(SECRET.getBytes(StandardCharsets.UTF_8)));
        return "Bearer " + jwt.serialize();
    }

    private void setListed(String auth, boolean listed) throws Exception {
        mvc.perform(put(BASE + "/settings").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"listed\":" + listed + "}"))
                .andExpect(status().isOk());
    }

    private void addViewer(String auth, String username) throws Exception {
        mvc.perform(post(BASE + "/viewers").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + username + "\"}"))
                .andExpect(status().isCreated());
    }

    private ResultActions pick(String auth, int taskId, String usernamesJson) throws Exception {
        return mvc.perform(put(BASE + "/tasks/" + taskId + "/audience").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"usernames\":" + usernamesJson + "}"));
    }

    private int createGroup(String auth, String name) throws Exception {
        MvcResult r = mvc.perform(post(BASE + "/groups").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isCreated()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.id");
    }

    private ResultActions addMembers(String auth, int groupId, String usernamesJson) throws Exception {
        return mvc.perform(post(BASE + "/groups/" + groupId + "/members").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"usernames\":" + usernamesJson + "}"));
    }

    private ResultActions groupAudience(String auth, int taskId, String groupIdsJson, boolean includeDefault) throws Exception {
        return mvc.perform(put(BASE + "/tasks/" + taskId + "/audience").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"mode\":\"groups\",\"groupIds\":" + groupIdsJson + ",\"includeDefault\":" + includeDefault + "}"));
    }

    // alice is listed; bob, carol and admin are listed and on alice's task viewers
    private void aliceWithThreeViewers() throws Exception {
        for (String id : List.of("s-alice", "s-bob", "s-carol", "s-admin")) {
            setListed(token(id, "user"), true);
        }
        String alice = token("s-alice", "user");
        addViewer(alice, "bob");
        addViewer(alice, "carol");
        addViewer(alice, "admin");
    }

    private int sendRequest(String auth, String username) throws Exception {
        MvcResult r = mvc.perform(post(BASE + "/requests").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + username + "\"}"))
                .andExpect(status().isCreated()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.id");
    }

    @Test
    void healthIsPublicEverythingElseNeedsAuth() throws Exception {
        mvc.perform(get(BASE + "/health")).andExpect(status().isOk());
        mvc.perform(get(BASE + "/discover")).andExpect(status().isUnauthorized());
    }

    @Test
    void newAccountsAreUnlistedAndCanBeListed() throws Exception {
        String alice = token("s-alice", "user");
        mvc.perform(get(BASE + "/settings").header("Authorization", alice))
                .andExpect(jsonPath("$.listed").value(false));
        setListed(alice, true);
        mvc.perform(get(BASE + "/settings").header("Authorization", alice))
                .andExpect(jsonPath("$.listed").value(true));
    }

    @Test
    void discoverShowsOnlyListedUsersWithoutStudentIds() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(alice, true);
        setListed(bob, true);

        mvc.perform(get(BASE + "/discover").header("Authorization", bob))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].person.username").value("alice"))
                .andExpect(jsonPath("$[0].person.studentId").doesNotExist());
        // admins get no student IDs either
        mvc.perform(get(BASE + "/discover").header("Authorization", token("s-admin", "admin")))
                .andExpect(jsonPath("$[*].person.username", containsInAnyOrder("alice", "bob")))
                .andExpect(jsonPath("$[*].person.studentId", hasSize(0)));
    }

    @Test
    void spaceShowsTasksByRelationship() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(alice, true);

        // stranger: open only
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.person.name").value("Alice"))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")))
                .andExpect(jsonPath("$.tasks[0].studentId").doesNotExist());
    }

    @Test
    void addingViewersRequiresListedTargetAndGrantsTrustedAccess() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(alice, true);

        // bob is unlisted, so alice cannot find/add him directly
        mvc.perform(post(BASE + "/viewers").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"bob\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User is Unlisted"));

        setListed(bob, true);
        mvc.perform(post(BASE + "/viewers").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"bob\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.relationship.addedMe").value(true))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        // one-way: bob did not add alice
        mvc.perform(get(BASE + "/spaces/bob").header("Authorization", alice))
                .andExpect(jsonPath("$.relationship.isMyTaskViewer").value(true))
                .andExpect(jsonPath("$.relationship.addedMe").value(false));

        mvc.perform(get(BASE + "/viewers").header("Authorization", alice))
                .andExpect(jsonPath("$[0].person.username").value("bob"));
        mvc.perform(delete(BASE + "/viewers/bob").header("Authorization", alice))
                .andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));
    }

    @Test
    void unlistedSpaceIsOwnerOnly() throws Exception {
        String bob = token("s-bob", "user");
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User is Unlisted"));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", token("s-alice", "user")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.self").value(true))
                .andExpect(jsonPath("$.tasks", hasSize(3)));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", token("s-admin", "admin")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User is Unlisted"));
        mvc.perform(get(BASE + "/spaces/nobody").header("Authorization", bob))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User not found"));
    }

    @Test
    void viewerAccessRequestFlow() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");

        // cannot request an unlisted user
        mvc.perform(post(BASE + "/requests").header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"alice\"}"))
                .andExpect(status().isNotFound());

        setListed(alice, true);
        int id = sendRequest(bob, "alice");
        mvc.perform(post(BASE + "/requests").header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"alice\"}"))
                .andExpect(status().isConflict());

        // unlisted bob is still shown to alice, because he asked
        mvc.perform(get(BASE + "/requests").header("Authorization", alice))
                .andExpect(jsonPath("$.incoming[0].id").value(id))
                .andExpect(jsonPath("$.incoming[0].person.username").value("bob"));
        mvc.perform(get(BASE + "/requests").header("Authorization", bob))
                .andExpect(jsonPath("$.outgoing[0].person.username").value("alice"));

        // only alice can accept
        mvc.perform(post(BASE + "/requests/" + id + "/accept").header("Authorization", bob))
                .andExpect(status().isNotFound());
        mvc.perform(post(BASE + "/requests/" + id + "/accept").header("Authorization", alice))
                .andExpect(status().isNoContent());

        mvc.perform(get(BASE + "/viewers").header("Authorization", alice))
                .andExpect(jsonPath("$[0].person.username").value("bob"));
        mvc.perform(get(BASE + "/requests").header("Authorization", alice))
                .andExpect(jsonPath("$.incoming", hasSize(0)));
        mvc.perform(post(BASE + "/requests").header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"alice\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("You are already one of their task viewers"));
    }

    @Test
    void declineAndCancel() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(alice, true);

        int first = sendRequest(bob, "alice");
        mvc.perform(post(BASE + "/requests/" + first + "/decline").header("Authorization", alice))
                .andExpect(status().isNoContent());
        int second = sendRequest(bob, "alice");
        mvc.perform(delete(BASE + "/requests/" + second).header("Authorization", alice))
                .andExpect(status().isNotFound());
        mvc.perform(delete(BASE + "/requests/" + second).header("Authorization", bob))
                .andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/viewers").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void viewTasksAndOpenFeedHideUnlistedOwners() throws Exception {
        String bob = token("s-bob", "user");
        // carol (unlisted) adds bob directly in the database; alice is listed
        jdbc.update("INSERT INTO task_viewers (owner_id, viewer_id) VALUES ('s-carol', 's-bob')");
        setListed(token("s-alice", "user"), true);

        mvc.perform(get(BASE + "/view-tasks").header("Authorization", bob))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].owner").value(nullValue()))
                .andExpect(jsonPath("$[0].tasks[*].title", containsInAnyOrder("carol trusted", "carol open")));

        mvc.perform(get(BASE + "/open-tasks").header("Authorization", bob))
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[?(@.task.title == 'alice open')].owner.username").value("alice"))
                .andExpect(jsonPath("$[?(@.task.title == 'carol open')].owner").value(contains(nullValue())));

        // admins do not see who it is either
        mvc.perform(get(BASE + "/open-tasks").header("Authorization", token("s-admin", "admin")))
                .andExpect(jsonPath("$[?(@.task.title == 'carol open')].owner").value(contains(nullValue())));
    }

    @Test
    void adminsGetNoExtraAccess() throws Exception {
        String admin = token("s-admin", "admin");
        setListed(token("s-alice", "user"), true);

        // listed space: open tasks only, like any stranger
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", admin))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")))
                .andExpect(jsonPath("$.person.studentId").doesNotExist());
        // cannot add an unlisted user as a viewer
        mvc.perform(post(BASE + "/viewers").header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"bob\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User is Unlisted"));
    }

    @Test
    void tokensOfDeletedAccountsAreRejected() throws Exception {
        String bob = token("s-bob", "user");
        mvc.perform(get(BASE + "/settings").header("Authorization", bob)).andExpect(status().isOk());
        jdbc.update("DELETE FROM users WHERE student_id = 's-bob'");
        mvc.perform(put(BASE + "/settings").header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"listed\":true}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void cannotTargetYourself() throws Exception {
        String alice = token("s-alice", "user");
        setListed(alice, true);
        mvc.perform(post(BASE + "/requests").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"alice\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(BASE + "/viewers").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"ALICE\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void handPickedTrustedTaskIsSeenOnlyByPickedViewers() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        String carol = token("s-carol", "user");
        for (String t : List.of(alice, bob, carol)) {
            setListed(t, true);
        }
        addViewer(alice, "bob");
        addViewer(alice, "carol");

        // All Trusted: both viewers see it
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));

        pick(alice, ALICE_TRUSTED, "[\"BOB\"]")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskId").value(ALICE_TRUSTED))
                .andExpect(jsonPath("$.people[*].username", contains("bob")))
                .andExpect(jsonPath("$.people[0].studentId").doesNotExist());

        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));
        mvc.perform(get(BASE + "/view-tasks").header("Authorization", carol))
                .andExpect(jsonPath("$[0].tasks[*].title", containsInAnyOrder("alice open")));
        mvc.perform(get(BASE + "/view-tasks").header("Authorization", bob))
                .andExpect(jsonPath("$[0].tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        // the owner still sees everything in their own Space
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", alice))
                .andExpect(jsonPath("$.tasks", hasSize(3)));

        mvc.perform(get(BASE + "/audiences").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].taskId").value(ALICE_TRUSTED))
                .andExpect(jsonPath("$[0].people[*].username", contains("bob")));
        mvc.perform(get(BASE + "/audiences").header("Authorization", bob))
                .andExpect(jsonPath("$", hasSize(0)));

        // back to All Trusted
        mvc.perform(delete(BASE + "/tasks/" + ALICE_TRUSTED + "/audience").header("Authorization", alice))
                .andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        mvc.perform(get(BASE + "/audiences").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void audienceMustBeYourOwnTaskViewers() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(bob, true);
        addViewer(alice, "bob");

        pick(alice, ALICE_TRUSTED, "[]").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Pick at least one person"));
        pick(alice, ALICE_TRUSTED, "[\"carol\"]").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("@carol is not one of your task viewers"));
        pick(alice, ALICE_TRUSTED, "[\"nobody\"]").andExpect(status().isBadRequest());
        // only the owner can set it
        pick(bob, ALICE_TRUSTED, "[\"bob\"]").andExpect(status().isNotFound());
        pick(alice, CAROL_TRUSTED, "[\"bob\"]").andExpect(status().isNotFound());
        mvc.perform(delete(BASE + "/tasks/" + ALICE_TRUSTED + "/audience").header("Authorization", bob))
                .andExpect(status().isNotFound());
    }

    @Test
    void removedViewerLosesAccessAndTaskStaysHandPicked() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        String carol = token("s-carol", "user");
        for (String t : List.of(alice, bob, carol)) {
            setListed(t, true);
        }
        addViewer(alice, "bob");
        addViewer(alice, "carol");
        pick(alice, ALICE_TRUSTED, "[\"bob\"]").andExpect(status().isOk());

        mvc.perform(delete(BASE + "/viewers/bob").header("Authorization", alice)).andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));
        mvc.perform(get(BASE + "/audiences").header("Authorization", alice))
                .andExpect(jsonPath("$[0].people", hasSize(0)));
        // with nobody left it does not fall back to All Trusted
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));

        // deleting the task removes its audience
        jdbc.update("DELETE FROM tasks WHERE id = ?", ALICE_TRUSTED);
        Integer left = jdbc.queryForObject("SELECT COUNT(*) FROM task_audiences WHERE task_id = ?", Integer.class, ALICE_TRUSTED);
        assertEquals(0, left);
    }

    @Test
    void groupsAreManagedInsideYourTaskViewers() throws Exception {
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        setListed(bob, true);
        setListed(token("s-carol", "user"), true);
        addViewer(alice, "bob");
        addViewer(alice, "carol");

        // everyone starts in Default
        mvc.perform(get(BASE + "/groups").header("Authorization", alice))
                .andExpect(jsonPath("$.groups", hasSize(0)))
                .andExpect(jsonPath("$.defaultMembers[*].username", contains("bob", "carol")));

        int study = createGroup(alice, "  Study   Buddies ");
        int friends = createGroup(alice, "Friends");
        mvc.perform(post(BASE + "/groups").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"study buddies\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post(BASE + "/groups").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"default\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(BASE + "/groups").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\" \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(BASE + "/groups").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"" + "x".repeat(31) + "\"}"))
                .andExpect(status().isBadRequest());

        // someone can be in several groups; Default is whoever is in none
        addMembers(alice, study, "[\"bob\",\"carol\"]").andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Study Buddies"))
                .andExpect(jsonPath("$.members[*].username", contains("bob", "carol")));
        addMembers(alice, friends, "[\"carol\"]").andExpect(status().isOk());
        addMembers(alice, friends, "[\"admin\"]").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("@admin is not one of your task viewers"));
        addMembers(alice, friends, "[]").andExpect(status().isBadRequest());
        mvc.perform(get(BASE + "/groups").header("Authorization", alice))
                .andExpect(jsonPath("$.groups[*].name", contains("Friends", "Study Buddies")))
                .andExpect(jsonPath("$.defaultMembers", hasSize(0)));

        // rename
        mvc.perform(put(BASE + "/groups/" + study).header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Lab\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Lab"));
        mvc.perform(put(BASE + "/groups/" + study).header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"FRIENDS\"}"))
                .andExpect(status().isConflict());

        // remove member: bob is in no group now, so back in Default
        mvc.perform(delete(BASE + "/groups/" + study + "/members/bob").header("Authorization", alice))
                .andExpect(status().isNoContent());
        mvc.perform(delete(BASE + "/groups/" + study + "/members/bob").header("Authorization", alice))
                .andExpect(status().isNotFound());
        mvc.perform(get(BASE + "/groups").header("Authorization", alice))
                .andExpect(jsonPath("$.defaultMembers[*].username", contains("bob")));

        // only the owner can touch their groups
        addMembers(bob, study, "[\"carol\"]").andExpect(status().isNotFound());
        mvc.perform(delete(BASE + "/groups/" + study).header("Authorization", bob)).andExpect(status().isNotFound());
        mvc.perform(get(BASE + "/groups").header("Authorization", bob)).andExpect(jsonPath("$.groups", hasSize(0)));

        // delete
        mvc.perform(delete(BASE + "/groups/" + friends).header("Authorization", alice)).andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/groups").header("Authorization", alice))
                .andExpect(jsonPath("$.groups[*].name", contains("Lab")));

        // leaving Your Task Viewers means leaving every group
        mvc.perform(delete(BASE + "/viewers/carol").header("Authorization", alice)).andExpect(status().isNoContent());
        addViewer(alice, "carol");
        mvc.perform(get(BASE + "/groups").header("Authorization", alice))
                .andExpect(jsonPath("$.groups[0].members", hasSize(0)))
                .andExpect(jsonPath("$.defaultMembers[*].username", contains("bob", "carol")));
    }

    @Test
    void groupAudienceFollowsGroupMembership() throws Exception {
        aliceWithThreeViewers();
        String alice = token("s-alice", "user");
        String bob = token("s-bob", "user");
        String carol = token("s-carol", "user");
        String admin = token("s-admin", "user");
        int study = createGroup(alice, "Study");
        int empty = createGroup(alice, "Empty");
        addMembers(alice, study, "[\"bob\"]").andExpect(status().isOk());
        // Default now: carol, admin

        groupAudience(alice, ALICE_TRUSTED, "[" + study + "]", false).andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("groups"))
                .andExpect(jsonPath("$.groups[*].name", contains("Study")))
                .andExpect(jsonPath("$.includeDefault").value(false));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));

        // Default only
        groupAudience(alice, ALICE_TRUSTED, "[]", true).andExpect(status().isOk());
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));
        mvc.perform(get(BASE + "/view-tasks").header("Authorization", carol))
                .andExpect(jsonPath("$[0].tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));

        // Study + Default: everyone
        groupAudience(alice, ALICE_TRUSTED, "[" + study + "," + empty + "]", true).andExpect(status().isOk());
        for (String t : List.of(bob, carol, admin)) {
            mvc.perform(get(BASE + "/spaces/alice").header("Authorization", t))
                    .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        }

        // Study only, then membership changes apply live
        groupAudience(alice, ALICE_TRUSTED, "[" + study + "]", false).andExpect(status().isOk());
        addMembers(alice, study, "[\"carol\"]").andExpect(status().isOk());
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", carol))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice trusted", "alice open")));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", admin))
                .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));

        mvc.perform(get(BASE + "/audiences").header("Authorization", alice))
                .andExpect(jsonPath("$[0].mode").value("groups"))
                .andExpect(jsonPath("$[0].groups[*].id", contains(study)));

        // deleting the only chosen group never widens access
        mvc.perform(delete(BASE + "/groups/" + study).header("Authorization", alice)).andExpect(status().isNoContent());
        for (String t : List.of(bob, carol, admin)) {
            mvc.perform(get(BASE + "/spaces/alice").header("Authorization", t))
                    .andExpect(jsonPath("$.tasks[*].title", containsInAnyOrder("alice open")));
        }

        // validation
        groupAudience(alice, ALICE_TRUSTED, "[]", false).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Pick at least one group"));
        int carolsGroup = createGroup(carol, "Mine");
        groupAudience(alice, ALICE_TRUSTED, "[" + carolsGroup + "]", false).andExpect(status().isBadRequest());
        mvc.perform(put(BASE + "/tasks/" + ALICE_TRUSTED + "/audience").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"everyone\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void whoCanSeeListsGroupsAndDefaultPeople() throws Exception {
        aliceWithThreeViewers();
        String alice = token("s-alice", "user");
        int study = createGroup(alice, "Study");
        addMembers(alice, study, "[\"bob\"]").andExpect(status().isOk());
        String who = BASE + "/tasks/" + ALICE_TRUSTED + "/who-can-see";

        // All Trusted: every group, plus Default people one by one
        mvc.perform(get(who).header("Authorization", alice))
                .andExpect(jsonPath("$.mode").value("all"))
                .andExpect(jsonPath("$.groups[0].name").value("Study"))
                .andExpect(jsonPath("$.groups[0].members[*].username", contains("bob")))
                .andExpect(jsonPath("$.people[*].person.username", contains("admin", "carol")))
                .andExpect(jsonPath("$.people[*].inDefault", contains(true, true)));

        // Hand-picked: the people, marked when in Default
        pick(alice, ALICE_TRUSTED, "[\"bob\",\"carol\"]").andExpect(status().isOk());
        mvc.perform(get(who).header("Authorization", alice))
                .andExpect(jsonPath("$.mode").value("picked"))
                .andExpect(jsonPath("$.groups", hasSize(0)))
                .andExpect(jsonPath("$.people[*].person.username", contains("bob", "carol")))
                .andExpect(jsonPath("$.people[*].inDefault", contains(false, true)));

        // Groups: chosen groups, Default people only when Default was chosen
        groupAudience(alice, ALICE_TRUSTED, "[" + study + "]", false).andExpect(status().isOk());
        mvc.perform(get(who).header("Authorization", alice))
                .andExpect(jsonPath("$.mode").value("groups"))
                .andExpect(jsonPath("$.groups[*].name", contains("Study")))
                .andExpect(jsonPath("$.people", hasSize(0)));
        groupAudience(alice, ALICE_TRUSTED, "[" + study + "]", true).andExpect(status().isOk());
        mvc.perform(get(who).header("Authorization", alice))
                .andExpect(jsonPath("$.people[*].person.username", contains("admin", "carol")))
                .andExpect(jsonPath("$.includeDefault").value(true));

        // only for my own Trusted tasks
        mvc.perform(get(BASE + "/tasks/900001/who-can-see").header("Authorization", alice))
                .andExpect(status().isBadRequest());
        mvc.perform(get(BASE + "/tasks/" + CAROL_TRUSTED + "/who-can-see").header("Authorization", alice))
                .andExpect(status().isNotFound());
    }
}
