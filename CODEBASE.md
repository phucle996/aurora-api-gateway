# Codebase Architecture & Assembly Matrix

This document defines the **structural organization and layering model** of the Aurora WAF & API Gateway codebase. It provides a clear architectural mental model for engineers: outlining the purpose of each layer, how they assemble together, and the system invariants—without tying them to transient object names or local file paths.

---

## 1. Controller Subsystem: Processing Pipeline & Layer Matrix

The central control plane is assembled into a strict unidirectional processing pipeline:

$$\text{Entry} \longrightarrow \text{Init} \longrightarrow \text{Composition} \longrightarrow [\text{Handler} \longrightarrow \text{Service} \longrightarrow \text{Domain} \longrightarrow \text{Repository}] + \text{Providers}$$

| Architectural Layer | Core Responsibilities & Processing Behavior | Assembly Role & Design Boundary |
| :--- | :--- | :--- |
| **Entry Layer** | - Acts as the process initiation point from the operating system.<br>- Intercepts operating system termination signals (`SIGINT`, `SIGTERM`).<br>- Instantiates the root execution context coordinating graceful process termination. | **Process Gateway**:<br>Governs the entire application lifecycle; ensures active write transactions commit cleanly before exit. |
| **Init Layer** | - Parses and validates environment configurations with strict fallback defaults.<br>- Configures isolated database connection pooling: 1 exclusive writer connection (eliminating write-lock contention) and concurrent readers.<br>- Executes database schema migrations in strict sequence (tables, indexes, triggers, seed data). | **Durable Foundation**:<br>Prepares storage and schema integrity before listening sockets or network interfaces open. |
| **Composition Layer** | - Assembles and wires subsystems following unidirectional Dependency Injection principles.<br>- Registers global security middlewares: token authentication, CORS validation, security headers, and Single Page Application fallback routing.<br>- Binds the gRPC streaming server socket for real-time edge node synchronization. | **Assembly Glue**:<br>Connects dependencies; strictly forbidden from implementing business logic or mutation behavior. |
| **Handler Layer (Transport)** | - Ingests inbound network requests over HTTP and gRPC protocols.<br>- Performs protocol decoding and payload format validation (data types, string bounds, JSON schema correctness).<br>- Maps transport payloads into flat, workflow-specific command structures. | **Protocol Decoupling**:<br>Isolates transport and network protocol details from internal application logic. |
| **Service Layer (Workflow Logic)** | - Orchestrates single-workflow operations from start to finish.<br>- Validates workflow preconditions and enforces multi-entity business invariants.<br>- Coordinates cryptographic digest calculations (e.g., SHA-256 releases) and invokes snapshot compilation routines. | **Workflow Authority**:<br>Each workflow is fully isolated; workflows never call other workflows directly to avoid blast-radius cascading failures. |
| **Domain Layer (Core Invariants)** | - Defines the fundamental domain concepts: flat workflow entities, value objects, and snapshot schemas.<br>- Enforces intrinsic boundary rules, state machine transitions, and error taxonomies.<br>- Guarantees that invalid domain states cannot be constructed or persisted. | **Kernel of Truth**:<br>The purest layer of the system; completely agnostic of transport, persistence, and external frameworks. |
| **Repository Layer (Persistence)** | - Expresses state transitions, multi-version queries, and mutations using Common Table Expressions (CTEs).<br>- Executes read-and-mutate operations atomically within a single database transaction.<br>- Maps relational rows directly to flat, workflow-specific projection models. | **Storage Boundary**:<br>Each query is bound to exactly one workflow; sharing queries across different workflows is strictly prohibited. |
| **Provider Layer (Background Workers)**| - Manages event-driven and recurring background daemons.<br>- Detects state mutations to trigger automatic cluster configuration snapshot synthesis.<br>- Houses decoupled asynchronous message and notification worker queues. | **Autonomous Operations**:<br>Executes in parallel background routines without blocking the main synchronous request-response path. |

---

## 2. Dataplane Agent Subsystem: Edge Node Assembly Matrix

The edge node daemon receives distributed specifications and materializes them into running web server instances:

| Architectural Layer | Core Responsibilities & Processing Behavior | Operational Policy & Invariants |
| :--- | :--- | :--- |
| **Bootstrap Layer** | - Reads node identity flags and authorization credentials from the runtime environment.<br>- Initializes local working state, policy directories, and baseline configuration files.<br>- Spawns the asynchronous multi-threaded runtime managing concurrent worker routines. | **Node Validation**:<br>Prevents startup if the node identity is missing or authorization tokens are invalid. |
| **gRPC Consumer Layer** | - Establishes a persistent, bi-directional streaming connection with the Controller.<br>- Continuously ingests distributed cluster specification snapshots.<br>- Verifies incoming configuration payload integrity via cryptographic digest comparison. | **Live Ingestion**:<br>Maintains an active connection channel; automatically reconnects with backoff upon network interruption. |
| **Reconciler & Jitter Layer** | - Diffs the newly received specification against the currently active local snapshot.<br>- **Enforces a randomized Jitter Delay (0 to 2500ms)** prior to applying changes.<br>- Dispatches synchronization status and observed release identifiers back to the Controller. | **Anti-Thundering Herd**:<br>Eliminates simultaneous reload spikes across large clusters to prevent origin upstream saturation. |
| **Materializer Layer** | - Translates logical abstract specification trees into concrete, static web server configuration files.<br>- Executes pre-flight syntax validation checks on generated configuration files.<br>- Signals graceful configuration reloads to the web server without dropping active TCP connections.<br>- Reverts to previous stable configuration files if syntax validation fails. | **Zero-Downtime Guarantee**:<br>Never allows an invalid configuration to crash or disrupt the active web server process. |
| **Extension Dispatcher Layer** | - Inspects enabled dynamic extensions declared in the cluster specification.<br>- Dynamically spawns or terminates in-memory worker tasks (e.g., bot challenges, distributed rate limiters).<br>- Updates module runtime parameters directly in memory. | **Dynamic Lifecycle**:<br>Allows live feature toggling and re-parameterization without restarting the daemon binary. |
| **Telemetry Layer** | - Extracts real-time runtime counters and connection metrics from the web server internal status.<br>- Formats and exposes metrics endpoints for standardized telemetry collection.<br>- Transmits periodic node heartbeat telemetry (CPU, memory, active sessions) to the Controller. | **Lightweight Observability**:<br>Operates independently of traffic routing paths; strictly limits overhead to less than 1% CPU utilization. |

---

## 3. Engine & FFI Subsystem: Real-Time Traffic Processing Matrix

The core security inspection engine and language bridge evaluate live HTTP requests at microsecond latency:

| Architectural Layer | Core Responsibilities & Processing Behavior | Execution & Memory Boundary |
| :--- | :--- | :--- |
| **Compiler Layer** | - Converts declarative inspection rules into deterministic binary snapshot structures.<br>- Pre-compiles string match patterns and regular expression graphs into contiguous memory layouts. | **Offline Optimization**:<br>Executed in the control plane; the dataplane only consumes pre-built, optimized binary snapshots. |
| **Vectorized Engine Layer** | - Performs parallel multi-pattern matching using Aho-Corasick and vectorized automata.<br>- Concurrently inspects all request elements: URI paths, request headers, query strings, and payload bodies.<br>- Computes threat anomaly scores to yield instantaneous decisions (Allow, Log, Block). | **Microsecond Performance**:<br>Operates purely in memory cache; optimizes for CPU L1/L2 data access to handle hundreds of thousands of requests per second per core. |
| **Radix Lookup Layer** | - Stores hierarchical network subnet ranges in an optimized Radix Tree structure.<br>- Resolves inbound client network addresses in deterministic $O(1)$ constant time. | **Instant IP Matching**:<br>Evaluates IP authorization boundaries with zero degradation regardless of dataset volume. |
| **FFI Safety Wrapper Layer** | - Exposes a standardized, C-compatible binary Application Binary Interface (ABI).<br>- Marshals memory buffers and pointer references between foreign host processes and native memory safely.<br>- Catches and encapsulates runtime panics at the boundary to prevent crashing host processes. | **Memory Boundary Safety**:<br>Strictly prevents memory corruption, unaligned reads, or panic propagation across language boundaries. |
| **Module Phase Hook Layer** | - Hooks directly into the web server HTTP processing access phase.<br>- Extracts request metadata and passes memory contexts to the inspection engine.<br>- Enforces the returned verdict: proceeds downstream, interrupts with status codes, or returns tailored responses. | **Non-blocking Event Loop**:<br>Integrated into the web server asynchronous pipeline without blocking worker thread event loops. |

---

## 4. Console UI Subsystem: Presentation Architecture Matrix

The management interface is organized into progressive shells, focused workspaces, and data abstractions:

| Presentation Layer | Core Responsibilities & Assembly Mechanics | UX Paradigm & Design Standard |
| :--- | :--- | :--- |
| **App Shell Layer** | - Manages active user session tokens, authentication state, and credential validation.<br>- Houses the global visual design tokens, dark/light theme providers, and top-level error boundaries. | **Foundation Shell**:<br>Ensures session continuity and guards against application-wide crashing. |
| **Layout & Navigation Layer** | - Renders the unified application frame: global sidebar navigation and cluster health headers.<br>- Manages seamless Single Page Application routing transitions without browser document reloads. | **Navigation Frame**:<br>Provides instantaneous state switching and contextual awareness across modules. |
| **Workspace Drawer Layer** | - Provides expansive, dedicated workspaces via **slide-up bottom drawers occupying 3/4 screen height (78vh)**.<br>- Renders specialized rule and metric data tables tailored to individual functional domains.<br>- Implements **Dual-Mode Editing**: visual form-based input $\leftrightarrow$ structured raw syntax editor with real-time bi-directional sync. | **Immersive Workspace**:<br>Replaces cramped popup modals with comprehensive, context-rich workspaces. |
| **API Transport Layer** | - Encapsulates typed HTTP client interactions with the central Controller APIs.<br>- Transforms inbound backend responses into reactive local component state.<br>- Handles system notification dispatching, error normalization, and user feedback alerts. | **Data Decoupling**:<br>Keeps visual layout components completely separated from HTTP transport and serialization mechanics. |

---

## 5. Architecture Invariants Matrix

Core architectural rules that all contributors must preserve across every modification:

| Architectural Principle | Mandatory Implementation Standard | Primary Benefit | Risk Prevented |
| :--- | :--- | :--- | :--- |
| **Workflow Isolation** | Every workflow owns an end-to-end stack: command, service logic, and repository queries. | Confines the blast radius of any code change to a single workflow. | Side-effects breaking adjacent system capabilities. |
| **Flat Entities** | Domain models and DTOs remain flat projections; nesting entities across workflows is forbidden. | Enforces clear domain authority and eliminates hidden dependency graphs. | Unintended cascading mutations and bloated object graphs. |
| **CTE-First Persistence** | Multi-step mutations and projections must reside within a single CTE SQL statement. | Guarantees transactional atomicity and query auditability at the database level. | Race conditions, phantom reads, and deadlocks. |
| **Immutable Ledgers** | Cluster specifications, ruleset releases, and policy versions are append-only. | Ensures total auditability, deterministic state reproducibility, and instantaneous rollback. | Unrecorded state drift and irrecoverable configurations. |
| **Jittered Sync** | Dataplane edge nodes must apply randomized jitter before executing process reloads. | Maintains upstream origin stability during cluster-wide configuration pushes. | Cascading outages caused by cluster-wide Thundering Herd. |
| **Non-blocking Data Plane** | Inspection engines and streaming workers must never execute blocking disk I/O in the request path. | Preserves microsecond packet evaluation latencies. | Event loop exhaustion, request queuing, and throughput collapse. |
