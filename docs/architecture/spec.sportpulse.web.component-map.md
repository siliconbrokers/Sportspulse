---
artifact_id: SPEC-SPORTPULSE-WEB-COMPONENT-MAP
title: "Frontend Component Map"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: component-map
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/architecture/spec.sportpulse.web.component-map.md
---
\# SportPulse Frontend Component Map

App

└── Layout  
    ├── Header  
    │   ├── Logo  
    │   ├── CompetitionSelector  
    │   ├── DateSelector  
    │   ├── ModeToggle  
    │   ├── SearchBar  
    │   ├── ThemeSwitch  
    │   └── UserActions  
    │  
    └── Dashboard  
        ├── TreemapCanvas  
        │   ├── TreemapLayout  
        │   ├── TeamTile  
        │   └── TileTooltip  
        │  
        ├── AgendaRail  
        │   ├── MatchCard  
        │   └── AgendaFilters  
        │  
        └── DetailPanel  
            ├── TeamHeader  
            ├── RecentForm  
            ├── NextMatch  
            └── DetailActions

