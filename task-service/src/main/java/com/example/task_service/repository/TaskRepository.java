package com.example.task_service.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import com.example.task_service.model.Task;


public interface TaskRepository extends JpaRepository<Task, Integer> {

    List<Task> findAllByOrderByCreatedAtDescIdDesc();

    List<Task> findByStudentIdOrderByCreatedAtDescIdDesc(String studentId);

    List<Task> findByVisibilityInOrderByCreatedAtDescIdDesc(List<String> visibilities);

    List<Task> findByStudentIdInAndVisibilityInOrderByCreatedAtDescIdDesc(List<String> studentIds, List<String> visibilities);

    @Transactional
    long deleteByStudentIdAndCompletedTrue(String studentId);
}
