package com.example.social_service.client;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class UserClient {
    private final RestClient client;

    public UserClient(@Value("${app.user-service.url}") String baseUrl, @Value("${app.internal.key}") String key) {
        this.client = RestClient.builder().baseUrl(baseUrl).defaultHeader("X-Internal-Key", key).build();
    }

    public Map<String, UserInfo> byIds(Collection<String> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return fetch("ids", ids).stream().collect(Collectors.toMap(UserInfo::studentId, Function.identity()));
    }

    public List<UserInfo> byUsernames(Collection<String> usernames) {
        return usernames.isEmpty() ? List.of() : fetch("usernames", usernames);
    }

    public UserInfo byUsername(String username) {
        return fetch("usernames", List.of(username)).stream()
                .filter(u -> username.equalsIgnoreCase(u.username()))
                .findFirst()
                .orElse(null);
    }

    private List<UserInfo> fetch(String param, Collection<String> values) {
        return client.get()
                .uri(b -> b.path("/internal/users").queryParam(param, String.join(",", values)).build())
                .retrieve()
                .body(new ParameterizedTypeReference<List<UserInfo>>() {
                });
    }
}
