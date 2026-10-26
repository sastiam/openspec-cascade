# Spec Delta: Generador de Catálogo Local de Tareas y Sincronizador Bidireccional

## Purpose

Genera y actualiza localmente tasks_catalog.json y tasks_catalog.md para mantener coherencia entre GitHub y el repositorio.

## ADDED Requirements

### Requirement: Local Catalog Maintenance
The catalog generator SHALL format local human-readable and machine-readable task catalogues.

#### Scenario: A task state changes in Project #4
- **WHEN** A task state changes in Project #4
- **THEN** The generator synchronizes tasks_catalog.json and tasks_catalog.md
