package com.example.task_service.dto;

import java.time.LocalDate;

// Body for creating (studentId is admin-only) and fully updating a task
public record TaskRequest(
        String title,
        String description,
        LocalDate deadline,
        String priority,
        String visibility,
        Boolean completed,
        String studentId) {
}
