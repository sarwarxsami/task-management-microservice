package com.example.task_service;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = { "app.jwt.secret=test-secret-that-is-at-least-32-characters",
        "app.internal.key=test-internal-key-that-is-at-least-32-chars" })
class TaskServiceApplicationTests {

	@Test
	void contextLoads() {
	}

}
