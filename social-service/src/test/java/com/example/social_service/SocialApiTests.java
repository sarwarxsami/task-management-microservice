package com.example.social_service;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyCollection;
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

    private static final List<TaskInfo> TASKS = List.of(
            task(1, "s-alice", "alice private", "only_me"),
            task(2, "s-alice", "alice trusted", "trusted"),
            task(3, "s-alice", "alice open", "open"),
            task(4, "s-carol", "carol trusted", "trusted"),
            task(5, "s-carol", "carol open", "open"));

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
        Map<String, UserInfo> byId = USERS.stream().collect(Collectors.toMap(UserInfo::studentId, Function.identity()));
        when(userClient.byIds(anyCollection())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return ids.stream().filter(byId::containsKey).collect(Collectors.toMap(id -> id, byId::get));
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
                .andExpect(jsonPath("$[0].person.studentId").value(nullValue()));
        mvc.perform(get(BASE + "/discover").header("Authorization", token("s-admin", "admin")))
                .andExpect(jsonPath("$[*].person.studentId", containsInAnyOrder("s-alice", "s-bob")));
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
    void unlistedSpaceIsAdminOnly() throws Exception {
        String bob = token("s-bob", "user");
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", bob))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User is Unlisted"));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", token("s-alice", "user")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.self").value(true))
                .andExpect(jsonPath("$.tasks", hasSize(3)));
        mvc.perform(get(BASE + "/spaces/alice").header("Authorization", token("s-admin", "admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.person.studentId").value("s-alice"))
                .andExpect(jsonPath("$.tasks", hasSize(3)));
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

        // admins see who it is
        mvc.perform(get(BASE + "/open-tasks").header("Authorization", token("s-admin", "admin")))
                .andExpect(jsonPath("$[?(@.task.title == 'carol open')].owner.username").value("carol"));
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
}
