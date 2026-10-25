package com.example.task_service.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.task_service.dto.StatusRequest;
import com.example.task_service.dto.TaskRequest;
import com.example.task_service.exception.ApiException;
import com.example.task_service.model.Task;
import com.example.task_service.service.TaskService;
import com.example.task_service.service.TaskService.Caller;

@RestController
@RequestMapping("/service/task-service")
public class TaskController {
    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @GetMapping("/tasks")
    public List<Task> getTasks(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String studentId) {
        return service.getTasks(caller(jwt), studentId);
    }

    @PostMapping("/tasks")
    public ResponseEntity<Task> addTask(@AuthenticationPrincipal Jwt jwt, @RequestBody TaskRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addTask(caller(jwt), request));
    }

    @PutMapping("/tasks/{id}")
    public Task updateTask(@AuthenticationPrincipal Jwt jwt, @PathVariable int id,
            @RequestBody TaskRequest request) {
        return service.updateTask(caller(jwt), id, request);
    }

    @PatchMapping("/tasks/{id}/status")
    public Task setStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable int id,
            @RequestBody StatusRequest request) {
        if (request.completed() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "completed is required");
        }
        return service.setStatus(caller(jwt), id, request.completed());
    }

    @DeleteMapping("/tasks/{id}")
    public ResponseEntity<Void> deleteTask(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.deleteTask(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/tasks/completed")
    public Map<String, Long> clearCompleted(@AuthenticationPrincipal Jwt jwt) {
        return Map.of("deleted", service.clearCompleted(caller(jwt)));
    }

    private static Caller caller(Jwt jwt) {
        return new Caller(jwt.getSubject(), "admin".equals(jwt.getClaimAsString("role")));
    }
}
