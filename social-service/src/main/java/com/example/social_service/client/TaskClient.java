package com.example.social_service.client;

import java.util.Collection;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class TaskClient {
    private final RestClient client;

    public TaskClient(@Value("${app.task-service.url}") String baseUrl, @Value("${app.internal.key}") String key) {
        this.client = RestClient.builder().baseUrl(baseUrl).defaultHeader("X-Internal-Key", key).build();
    }

    // Tasks of the given owners (all owners when empty) with one of the given visibilities
    public List<TaskInfo> tasks(Collection<String> studentIds, Collection<String> visibilities) {
        return client.get()
                .uri(b -> b.path("/internal/tasks")
                        .queryParam("studentIds", String.join(",", studentIds))
                        .queryParam("visibilities", String.join(",", visibilities))
                        .build())
                .retrieve()
                .body(new ParameterizedTypeReference<List<TaskInfo>>() {
                });
    }
}
