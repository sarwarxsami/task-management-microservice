package com.example.task_service.controller;

import java.util.List;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.task_service.model.Task;
import com.example.task_service.service.UserService;

@RestController
public class UserController {
    private final UserService service;

    public UserController(UserService service) {
        this.service = service;
    }

    @GetMapping("/debug")
public String debug(@Autowired DataSource dataSource) throws Exception {
    var conn = dataSource.getConnection();

    return 
        "Database: " + conn.getCatalog() +
        "\nUser: " + conn.getMetaData().getUserName() +
        "\nURL: " + conn.getMetaData().getURL();
}

    @GetMapping("/service/show/task")
    public List<Task> getTasks() {
        return service.getTasks();
    }

}