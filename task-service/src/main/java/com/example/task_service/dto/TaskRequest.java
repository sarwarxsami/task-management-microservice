package com.example.task_service.dto;

import java.time.LocalDate;

// Body for creating and fully updating a task; the owner is always the caller
public record TaskRequest(
        String title,
        String description,
        LocalDate deadline,
        String priority,
        String visibility,
        Boolean completed) {
}
