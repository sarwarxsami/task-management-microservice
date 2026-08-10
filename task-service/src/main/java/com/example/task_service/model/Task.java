package com.example.task_service.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;

    @Column(name = "student_id")
    private String studentId;

    @Column(name = "task")
    private String task;

    public Task() {
    }

    public Task(int id, String studentId, String task) {
        this.id = id;
        this.studentId = studentId;
        this.task = task;
    }

    public int getId() {
        return id;
    }

    public String getStudentId() {
        return studentId;
    }

    public String getTask() {
        return task;
    }

    public void setStudentId(String studentId) {
        this.studentId = studentId;
    }

    public void setTask(String task) {
        this.task = task;
    }
}