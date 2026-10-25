package com.example.task_service.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.example.task_service.model.Task;
import com.example.task_service.service.TaskService;

@WebMvcTest(TaskController.class)
class TaskControllerTests {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private TaskService service;

    @Test
    void showTasksReturnsAllTasks() throws Exception {
        when(service.getTasks()).thenReturn(List.of(new Task("12345", "Learn Docker")));

        mvc.perform(get("/service/task-service/show/task"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].studentId").value("12345"))
                .andExpect(jsonPath("$[0].task").value("Learn Docker"));
    }

    @Test
    void addTaskCreatesTask() throws Exception {
        mvc.perform(post("/service/task-service/add/task")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"studentId\":\"12345\",\"task\":\"Learn Docker\"}"))
                .andExpect(status().isCreated())
                .andExpect(content().string("Task added successfully"));

        verify(service).addTask("12345", "Learn Docker");
    }

    @Test
    void addTaskRejectsMissingFields() throws Exception {
        mvc.perform(post("/service/task-service/add/task")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"studentId\":\"12345\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Missing required fields"));

        verify(service, never()).addTask(any(), any());
    }

    @Test
    void addTaskReturnsNotFoundForUnknownUser() throws Exception {
        when(service.addTask("nope", "Learn Docker"))
                .thenThrow(new DataIntegrityViolationException("fk_user"));

        mvc.perform(post("/service/task-service/add/task")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"studentId\":\"nope\",\"task\":\"Learn Docker\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User not found"));
    }
}
