package com.example.task_service.repository;

import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import com.example.task_service.model.Task;


public interface TaskRepository extends JpaRepository<Task, Integer> {

    List<Task> findByStudentIdOrderByCreatedAtDescIdDesc(String studentId);

    List<Task> findByVisibilityIn(List<String> visibilities, Pageable page);

    List<Task> findByVisibilityInAndStudentIdNot(List<String> visibilities, String excludedStudentId, Pageable page);

    List<Task> findByStudentIdInAndVisibilityIn(List<String> studentIds, List<String> visibilities, Pageable page);

    @Transactional
    long deleteByStudentIdAndCompletedTrue(String studentId);
}
