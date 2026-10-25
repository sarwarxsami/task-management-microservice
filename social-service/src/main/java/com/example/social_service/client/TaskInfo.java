package com.example.social_service.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// Task as returned by task-service; dates are passed through unchanged
@JsonIgnoreProperties(ignoreUnknown = true)
public record TaskInfo(
        int id,
        String studentId,
        String title,
        String description,
        String deadline,
        String priority,
        String visibility,
        boolean completed,
        String completedAt,
        String createdAt,
        String updatedAt) {
}
