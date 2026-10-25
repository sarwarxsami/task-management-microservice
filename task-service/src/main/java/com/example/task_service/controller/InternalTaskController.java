package com.example.task_service.controller;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.task_service.exception.ApiException;
import com.example.task_service.model.Task;
import com.example.task_service.service.TaskService;

// Service-to-service API; nginx only proxies /service/task-service, so this is not public
@RestController
@RequestMapping("/internal")
public class InternalTaskController {
    private final TaskService service;
    private final byte[] internalKey;

    public InternalTaskController(TaskService service, @Value("${app.internal.key}") String internalKey) {
        if (internalKey == null || internalKey.length() < 32) {
            throw new IllegalStateException("INTERNAL_API_KEY must be set and at least 32 characters long");
        }
        this.service = service;
        this.internalKey = internalKey.getBytes(StandardCharsets.UTF_8);
    }

    // GET /internal/tasks?visibilities=trusted,open[&studentIds=a,b]
    @GetMapping("/tasks")
    public List<Task> tasks(@RequestHeader(name = "X-Internal-Key", required = false) String key,
            @RequestParam(defaultValue = "") String studentIds,
            @RequestParam String visibilities) {
        if (key == null || !MessageDigest.isEqual(internalKey, key.getBytes(StandardCharsets.UTF_8))) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid internal key");
        }
        return service.findForSharing(split(studentIds), split(visibilities));
    }

    private static List<String> split(String value) {
        return Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
