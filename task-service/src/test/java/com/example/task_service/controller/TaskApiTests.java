package com.example.task_service.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

// Integration tests: need a Postgres with db/init.sql applied (DB_* env vars)
@SpringBootTest(properties = "app.jwt.secret=" + TaskApiTests.SECRET)
@AutoConfigureMockMvc
class TaskApiTests {

    static final String SECRET = "test-secret-that-is-at-least-32-characters";
    private static final String BASE = "/service/task-service";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        cleanUp();
        jdbc.update("INSERT INTO users (name, student_id) VALUES ('Alice', 'j-alice'), ('Bob', 'j-bob')");
    }

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM users WHERE student_id IN ('j-alice', 'j-bob', 'j-admin')");
    }

    private static String token(String studentId, String role, String secret) throws Exception {
        var claims = new JWTClaimsSet.Builder()
                .subject(studentId)
                .claim("role", role)
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .build();
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner(secret.getBytes(StandardCharsets.UTF_8)));
        return "Bearer " + jwt.serialize();
    }

    private static String token(String studentId, String role) throws Exception {
        return token(studentId, role, SECRET);
    }

    private int createTask(String auth, String body) throws Exception {
        MvcResult result = mvc.perform(post(BASE + "/tasks").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(result.getResponse().getContentAsString(), "$.id");
    }

    private void complete(String auth, int id) throws Exception {
        mvc.perform(patch(BASE + "/tasks/" + id + "/status").header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"completed\":true}"))
                .andExpect(status().isOk());
    }

    @Test
    void healthIsPublicAndTasksRequireAuth() throws Exception {
        mvc.perform(get(BASE + "/health")).andExpect(status().isOk());
        mvc.perform(get(BASE + "/tasks")).andExpect(status().isUnauthorized());
        mvc.perform(get(BASE + "/tasks").header("Authorization",
                token("j-alice", "user", "a-different-secret-that-is-32-chars-long")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Invalid or expired token"));
    }

    @Test
    void createWithAllFieldsAndDefaults() throws Exception {
        String alice = token("j-alice", "user");

        mvc.perform(post(BASE + "/tasks").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\" Write report \",\"description\":\"Chapter 2\",\"deadline\":\"2030-01-15\",\"priority\":\"high\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Write report"))
                .andExpect(jsonPath("$.description").value("Chapter 2"))
                .andExpect(jsonPath("$.deadline").value("2030-01-15"))
                .andExpect(jsonPath("$.priority").value("high"))
                .andExpect(jsonPath("$.completed").value(false))
                .andExpect(jsonPath("$.studentId").value("j-alice"));

        mvc.perform(post(BASE + "/tasks").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Minimal\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.priority").value("medium"))
                .andExpect(jsonPath("$.deadline").doesNotExist());
    }

    @Test
    void rejectsInvalidInput() throws Exception {
        String alice = token("j-alice", "user");
        mvc.perform(post(BASE + "/tasks").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"  \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(BASE + "/tasks").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\",\"priority\":\"urgent\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(BASE + "/tasks").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\",\"deadline\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Invalid request"));
    }

    @Test
    void usersOnlyAccessTheirOwnTasks() throws Exception {
        String alice = token("j-alice", "user");
        String bob = token("j-bob", "user");
        int id = createTask(alice, "{\"title\":\"Alice task\"}");

        mvc.perform(get(BASE + "/tasks").header("Authorization", bob))
                .andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(get(BASE + "/tasks?studentId=j-alice").header("Authorization", bob))
                .andExpect(status().isForbidden());
        mvc.perform(put(BASE + "/tasks/" + id).header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"hacked\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete(BASE + "/tasks/" + id).header("Authorization", bob))
                .andExpect(status().isNotFound());
        mvc.perform(post(BASE + "/tasks").header("Authorization", bob)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\",\"studentId\":\"j-alice\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(get(BASE + "/tasks").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].title").value("Alice task"));
    }

    @Test
    void updateToggleAndDelete() throws Exception {
        String alice = token("j-alice", "user");
        int id = createTask(alice, "{\"title\":\"Draft\",\"deadline\":\"2030-01-01\"}");

        mvc.perform(put(BASE + "/tasks/" + id).header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Final\",\"description\":\"done soon\",\"priority\":\"low\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Final"))
                .andExpect(jsonPath("$.priority").value("low"))
                .andExpect(jsonPath("$.deadline").doesNotExist());

        mvc.perform(patch(BASE + "/tasks/" + id + "/status").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"completed\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completed").value(true))
                .andExpect(jsonPath("$.completedAt").exists());

        mvc.perform(patch(BASE + "/tasks/" + id + "/status").header("Authorization", alice)
                .contentType(MediaType.APPLICATION_JSON).content("{\"completed\":false}"))
                .andExpect(jsonPath("$.completed").value(false))
                .andExpect(jsonPath("$.completedAt").doesNotExist());

        mvc.perform(delete(BASE + "/tasks/" + id).header("Authorization", alice))
                .andExpect(status().isNoContent());
        mvc.perform(get(BASE + "/tasks").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void clearCompletedOnlyRemovesOwnCompletedTasks() throws Exception {
        String alice = token("j-alice", "user");
        String bob = token("j-bob", "user");
        int done = createTask(alice, "{\"title\":\"done\"}");
        createTask(alice, "{\"title\":\"open\"}");
        int bobDone = createTask(bob, "{\"title\":\"bob done\"}");
        complete(alice, done);
        complete(bob, bobDone);

        mvc.perform(delete(BASE + "/tasks/completed").header("Authorization", alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(1));
        mvc.perform(get(BASE + "/tasks").header("Authorization", alice))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].title").value("open"));
        mvc.perform(get(BASE + "/tasks").header("Authorization", bob))
                .andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void adminSeesAndManagesAllTasks() throws Exception {
        String alice = token("j-alice", "user");
        String admin = token("j-admin", "admin");
        int id = createTask(alice, "{\"title\":\"Alice task\"}");
        createTask(admin, "{\"title\":\"For Bob\",\"studentId\":\"j-bob\"}");

        mvc.perform(get(BASE + "/tasks?studentId=j-bob").header("Authorization", admin))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].studentId").value("j-bob"));
        mvc.perform(put(BASE + "/tasks/" + id).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Edited by admin\"}"))
                .andExpect(status().isOk());
        mvc.perform(post(BASE + "/tasks").header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\",\"studentId\":\"nobody\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User not found"));
    }

    @Test
    void deletingUserCascadesTasks() throws Exception {
        String alice = token("j-alice", "user");
        createTask(alice, "{\"title\":\"will vanish\"}");
        jdbc.update("DELETE FROM users WHERE student_id = 'j-alice'");
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM tasks WHERE student_id = 'j-alice'", Integer.class);
        assertEquals(0, count);
    }
}
