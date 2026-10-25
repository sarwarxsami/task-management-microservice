package com.example.task_service.controller;

import java.util.List;
import java.util.Map;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.task_service.dto.AddTaskRequest;
import com.example.task_service.model.Task;
import com.example.task_service.service.TaskService;

@RestController
public class TaskController {
    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping("/service/task-service/show/task")
    public List<Task> getTasks() {
        return service.getTasks();
    }

    @PostMapping("/service/task-service/add/task")
    public ResponseEntity<?> addTask(@RequestBody AddTaskRequest request) {
        if (isBlank(request.studentId()) || isBlank(request.task())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required fields"));
        }

        try {
            service.addTask(request.studentId().trim(), request.task().trim());
        } catch (DataIntegrityViolationException e) {
            // tasks.student_id has a foreign key to users.student_id
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "User not found"));
        }

        return ResponseEntity.status(HttpStatus.CREATED).body("Task added successfully");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
