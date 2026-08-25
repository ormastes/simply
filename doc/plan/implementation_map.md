# Simple: whole-world software implementation map

The program should use **two orthogonal catalogs**:

1. **Application and subject domains**: education, healthcare, aerospace, shipping, finance, entertainment, and so on.
2. **Reusable infrastructure**: language, compiler, libraries, operating systems, storage, databases, cloud, simulation, control, CAD, robotics, and tools.

The central design principle is:

> Do not implement every subject as an independent product. Implement universal application and physical-world platforms, then add relatively small domain packs wherever possible.

For example:

```text
Education =
    universal enterprise/application kernel
  + documents and collaboration
  + scheduling and billing
  + course/roster/assessment/credential domain pack

Aircraft =
    universal enterprise/application kernel
  + engineering/simulation platform
  + real-time control platform
  + navigation and autonomy
  + aircraft/avionics domain pack
```

The repository is already substantial rather than an empty design exercise: the August 2026 inventory reports about **7.31 million owned source/test SLOC**, including roughly 939,000 compiler source SLOC, 879,000 library source SLOC, 311,000 OS source SLOC, 93,000 browser source SLOC, 178,000 UI/rendering source SLOC and 72,000 Caret source SLOC. A separate inventory identifies **5,147 Pure Simple library modules**.

At the same time, the implementation is highly asymmetric:

* Language, compiler, verification, developer tooling and rendering are comparatively strong.
* OS, browser, Office, embedded systems, hardware and AI have meaningful implementations but large parity gaps.
* Enterprise has many real domain kernels, but they are not yet one integrated suite.
* Cloud, distributed data, full database-server parity, collaboration, industrial control, robotics and specialist physical domains remain much less complete.

## How the scores work

The scores are my repository-audit estimates as of **August 23, 2026**, with an uncertainty of roughly ±10 percentage points.

| Score               | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| **F — Feature**     | Functional breadth and depth relative to a mature current reference product or standard set   |
| **U — Usability**   | End-to-end workflows, configuration, discoverability, UI, interoperability and administration |
| **P — Performance** | Performance parity where a meaningful runnable implementation exists                          |
| **Done**            | `55% F + 25% U + 20% P`; where P is unavailable, F/U are renormalized                         |

**Stability, adoption, community size, vendor support and long-term maintenance are deliberately excluded.**

`100` means approximate feature parity with a mature reference class for that row. For the Simple language itself, `F=100` recognizes that its documented semantic feature breadth already exceeds that of many individual outside languages; libraries and ecosystem tooling are scored separately.

The available cross-language report supports a substantial, but not uniformly leading, performance score: Simple native cold start was about 3.53 ms versus C at 3.03 ms, Go at 57.13 ms and Python at 24.29 ms; recursive `fib(35)` was about 65.12 ms versus Go at 55.34 ms and C at 15.21 ms. A multicore fan-out candidate recorded 14.14 ms versus Go at 8.04 ms. The report also notes one-run measurement limitations and failing execution modes, so these numbers should not be generalized to every workload.

---

# List 1 — Application and subject domains

## Summary

Most information-centric subjects can reuse **60–95%** of a universal application/enterprise platform. Their domain packs mainly contribute vocabulary, rules, standards, workflows and specialized user interfaces.

Physical and scientific subjects reuse less of the enterprise suite. They require substantial additional infrastructure for simulation, control, geometry, devices, real-time execution and scientific algorithms.

Abbreviations:

* **UAK** — Universal Application Kernel
* **DEV** — Developer and software-factory platform
* **MED** — Media, graphics and interactive platform
* **SCI** — Scientific computing platform
* **ENG** — CAD/CAE/EDA/PLM engineering platform
* **PWP** — Physical-World Platform: simulation, device, control, navigation and robotics
* **Pack** — domain-specific extension

| ID      | Subject family                                    |  Reusable base / domain pack | Principal domain-specific work                                                                           | Main infra                      |    F/U/P |    Done |
| ------- | ------------------------------------------------- | ---------------------------: | -------------------------------------------------------------------------------------------------------- | ------------------------------- | -------: | ------: |
| **A01** | Productivity and collaboration                    |            UAK 95% / Pack 5% | Full-fidelity documents, coauthoring, mail, calendar, chat, meeting, records and content management      | I23–I29, I37                    |  45/28/— | **40%** |
| **A02** | Enterprise operations                             |           UAK 85% / Pack 15% | Integrated ERP, CRM, HCM, finance, procurement, SCM, service, project and BI workflows                   | I18–I20, I23, I29               |  35/20/— | **30%** |
| **A03** | Commerce, hospitality and travel                  |           UAK 80% / Pack 20% | Marketplace, POS, restaurant, hotel, rental, ticketing, reservation, fulfillment and customer service    | I18, I23, I29, I37              |  28/16/— | **24%** |
| **A04** | Education and training                            |           UAK 75% / Pack 25% | SIS, LMS, courses, rosters, assessment, credentials, learning analytics and virtual laboratories         | I23, I28–I31, I37               |   15/8/— | **13%** |
| **A05** | Healthcare, clinical, biotech and pharma          |           UAK 55% / Pack 45% | EHR, terminology, laboratory, pharmacy, imaging, trials, medical devices and clinical decision support   | I16, I18, I23, I29–I33          |    7/4/— |  **6%** |
| **A06** | Government, legal and public safety               |           UAK 75% / Pack 25% | Cases, legislation, tax, permits, registries, evidence, elections, emergency response and civic GIS      | I16, I18, I20, I28–I29, I36     |   10/6/— |  **9%** |
| **A07** | Banking, insurance and capital markets            |           UAK 50% / Pack 50% | Core banking, settlement, payments, lending, insurance, matching, portfolio, risk and fraud              | I16, I18–I21, I29–I31           | 20/10/20 | **18%** |
| **A08** | Logistics, supply chain, warehouse and postal     |           UAK 70% / Pack 30% | WMS, TMS, fleet, routing, ports, customs, postal networks and supply-chain optimization                  | I18–I20, I29, I31, I36          |  20/12/— | **18%** |
| **A09** | Consumer, home, social and personal software      |           UAK 65% / Pack 35% | Social graph/feed, personal data, travel, home automation, consumer media and family services            | I23–I25, I29–I30, I37           |   12/8/— | **11%** |
| **A10** | Developer and software factory                    |           DEV 85% / Pack 15% | Complete Git forge, CI/CD, registries, collaborative IDE, cloud workspaces and release operations        | I01–I09, I17, I22               | 78/60/65 | **71%** |
| **A11** | IT, cloud, security and managed operations        |      Infra 80% / Product 20% | Cloud portal, IAM, SOC, APM, ITSM, fleet management, policy and self-service platform                    | I09, I12, I16–I23, I38          | 28/18/30 | **26%** |
| **A12** | Media, creative and publishing                    |           MED 40% / Pack 60% | Raster/vector editing, photography, 3D creation, DAW, NLE, VFX, color and asset pipelines                | I25–I27, I30–I31                |  10/6/18 | **11%** |
| **A13** | Games, XR and interactive simulation              |       MED+SCI 25% / Pack 75% | ECS, physics, animation, editor, multiplayer, terrain, particles, XR and content tooling                 | I20, I25–I27, I30–I32           | 18/10/25 | **17%** |
| **A14** | Manufacturing and factory automation              |       UAK+PWP 45% / Pack 55% | MES, SCADA, PLC, robot, CNC, machine vision, quality, scheduling and maintenance                         | I18–I20, I29, I32–I35, I38      |  15/8/20 | **14%** |
| **A15** | Semiconductor design and fabrication              |       SCI+ENG 25% / Pack 75% | RTL, simulation, synthesis, place-and-route, timing, physical verification, fab MES and yield            | I07, I10, I31–I35               | 28/14/28 | **25%** |
| **A16** | Robotics and autonomous machines                  |           PWP 20% / Pack 80% | Kinematics, dynamics, motion planning, SLAM, perception, manipulation, locomotion and fleets             | I30–I33, I35                    |    8/4/— |  **7%** |
| **A17** | Automotive and road mobility                      |       UAK+PWP 25% / Pack 75% | ECU stack, vehicle networks, diagnostics, OTA, powertrain, ADAS, autonomy, BMS and charging              | I12–I17, I30–I35, I38           |    7/4/— |  **6%** |
| **A18** | Rail and mass transit                             |       UAK+PWP 30% / Pack 70% | Signalling, interlocking, ATP/ATO, traction, braking, timetable and dispatch                             | I12–I17, I31–I36                |    4/2/— |  **3%** |
| **A19** | Ship, maritime, port and offshore                 |       UAK+PWP 30% / Pack 70% | Bridge, electronic charts, propulsion, stability, cargo, ballast, fleet and port automation              | I12–I17, I31–I36                |    5/3/— |  **4%** |
| **A20** | Submarine, AUV, ROV and deep ocean                |           PWP 20% / Pack 80% | Sonar/acoustics, inertial navigation, depth/ballast, underwater comms, life support and ocean missions   | I12–I17, I31–I36                |    4/2/— |  **3%** |
| **A21** | Aircraft, helicopter, UAV and airport             |           PWP 20% / Pack 80% | Avionics, FMS, GNC, fly-by-wire, FADEC, radar, communications, maintenance and air operations            | I07, I10–I17, I31–I36           |    7/4/— |  **6%** |
| **A22** | Rocket, launch vehicle and launch site            |           PWP 15% / Pack 85% | Countdown, launch sequencing, GNC, propulsion, stages, separation, range and ground support              | I07, I10–I17, I31–I35, I38      |    8/4/— |  **7%** |
| **A23** | Satellite, spacecraft and ground station          |           PWP 15% / Pack 85% | Flight executive, ADCS, orbit, power, thermal, telemetry, payload and mission control                    | I07, I10–I17, I31–I35, I38      |   10/5/— |  **8%** |
| **A24** | Deep-space probe, robot and habitat               |        PWP+AI 10% / Pack 90% | Autonomous planning, optical navigation, DTN, hibernation, science prioritization and remote repair      | I12–I17, I30–I33, I38           |    5/2/— |  **4%** |
| **A25** | Energy, utilities, nuclear, grid and battery      |       UAK+PWP 30% / Pack 70% | Grid/EMS, generation, reactor/plant control, renewables, battery/BMS and infrastructure twins            | I18–I20, I29, I31–I36           |    6/3/— |  **5%** |
| **A26** | Mining, oil, gas, chemical and process industries |       UAK+PWP 35% / Pack 65% | Geology, seismic, mine planning, drilling, reservoir, refinery, pipeline and process safety              | I31–I36                         |    5/3/— |  **4%** |
| **A27** | Architecture, civil, BIM and smart city           |       UAK+ENG 55% / Pack 45% | Architectural/BIM model, structural, geotechnical, MEP, construction and city/building twins             | I29, I31–I36                    |    8/5/— |  **7%** |
| **A28** | Agriculture, food and environment                 |       UAK+SCI 55% / Pack 45% | Crop, soil, irrigation, weather, livestock, greenhouse, autonomous machinery and food traceability       | I29–I36                         |    6/4/— |  **5%** |
| **A29** | Telecom, radio and network operator               |         Infra 25% / Pack 75% | SDR, modem, RF, cellular RAN/core, IMS, OSS/BSS, satellite communications and spectrum                   | I10–I17, I20–I23, I31           |  14/8/18 | **13%** |
| **A30** | Science, HPC, laboratory, Earth and astronomy     |           SCI 20% / Pack 80% | Scientific workflows, instruments, domain solvers, visualization, provenance and large-scale computation | I03–I08, I10, I19, I30–I32, I36 | 30/18/40 | **29%** |
| **A31** | Safety-critical and mission systems               | PWP+assurance 25% / Pack 75% | Deterministic control, partitioning, fault management, hazard models, evidence and mission operations    | I05, I07, I10–I17, I32–I35, I38 | 22/12/25 | **20%** |

### Application-list result

Using equal category weights:

| Measure                                                    | Current estimate |
| ---------------------------------------------------------- | ---------------: |
| Feature coverage                                           |          **17%** |
| Usability parity                                           |          **10%** |
| Performance parity among categories with runnable evidence |          **29%** |
| Composite completion                                       |          **15%** |

This low aggregate does not mean the repository is small. It means that “all world software” contains a huge number of domain-specific functions, and most physical-world domains have not yet reached product implementation.

The strongest application subjects are currently:

1. Developer/software factory.
2. Productivity and Office foundations.
3. Enterprise operations.
4. Science/HPC foundations.
5. Semiconductor/hardware tooling.

The Office and enterprise audit confirms that Writer, Calc, Slides, Base, Draw, Math, Mail, Planner, formats, charts, pivots and numerous enterprise kernels exist, while also concluding that they are not yet a unified collaborative production suite.

---

# List 2 — Infrastructure, frameworks, libraries and tools

## Summary

This list is the more important one. Application completion will rise quickly only after these shared platforms are complete.

The current center of gravity is:

```text
Strong:
language → compiler → verification → developer tools

Medium:
runtime → libraries → UI/rendering → OS → embedded → AI → Office

Early:
database server → data platform → cloud → collaboration
→ simulation → control → robotics → industrial → CAD/CAE
```

CNCF’s landscape and LF AI & Data illustrate how many distinct infrastructure classes sit beneath modern cloud, data and AI products. They should be treated as completeness catalogs rather than architectures to clone. ([CNCF Landscape][1])

## 2A. Programming and software-factory foundation

| ID      | Infrastructure family                    | Complete target                                                                                                           | Current Simple state and largest gap                                                                                        |     F/U/P |    Done |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------: | ------: |
| **I01** | Language semantics and type system       | Types, ownership, effects, generics, sum types, reflection, macros, AOP, math/loss DSLs, concurrency and domain extension | Unusually broad documented feature set; remaining issue is uniform support across execution modes and libraries             | 100/80/70 | **89%** |
| **I02** | Compiler, IR, backend, linker and loader | Frontend, HIR/MIR, optimizer, incremental build, AOT, JIT, interpreter, native, WASM, GPU, hardware and formal backends   | Substantial self-hosted staged toolchain; backend and execution-path parity remain incomplete                               |  82/62/65 | **74%** |
| **I03** | Runtime, memory and concurrency          | GC/no-GC, mutable/immutable, sync/async, actor/task/thread, SIMD/GPU, scheduler, reflection and plugin runtimes           | Multiple runtime families and concurrency models exist; common API parity and consistently fast paths remain incomplete     |  75/55/58 | **67%** |
| **I04** | Standard library                         | Collections, algorithms, text, numeric, date/time, IO, crypto, compression, serialization, networking and portability     | More than 5,000 Pure Simple modules exist; depth, canonical APIs, documentation and measured performance remain uneven      |  65/48/55 | **59%** |
| **I05** | FFI, ABI and language interoperability   | Generated C/C++/Rust/Python/JS/Fortran interfaces, safe contracts, dynamic loading and binary compatibility               | SFFI and several compatibility paths exist; full ABI coverage and safe foreign-code contract verification remain incomplete |  65/50/60 | **60%** |
| **I06** | Build, package and dependency system     | Manifest, lockfile, registry, binary cache, hermetic build, distributed build, provenance and cross compilation           | Broad CLI/build/package surface exists; complete hosted registry and hermetic distributed pipeline are missing              |  62/50/50 | **57%** |
| **I07** | Testing, specification and assurance     | Unit/integration/system, property, fuzz, model, formal, coverage, mutation, replay, traceability and qualification        | SSpec, SPipe, doctest, Lean and traceability are major strengths; conformance and evidence integrity still need closure     |  86/72/70 | **79%** |
| **I08** | IDE, editor, debugger and documentation  | Shared workbench, language server, debugger, profiler, refactoring, notebooks, docs, remote and collaborative development | Many editor/LSP/DAP/MCP modules exist; one polished unified IDE/workbench remains unfinished                                |  65/48/48 | **57%** |
| **I09** | SCM, CI/CD and software forge            | Git/JJ hosting, reviews, issues, CI, releases, package/artifact/container registries and build farms                      | Client/tool components exist; a complete GitHub/GitLab-class hosted service does not yet exist                              |  40/28/38 | **37%** |

Simple’s application CLI already exposes a broad set of compiler, build, test, lint, package, LSP, DAP, MCP, documentation, release, VCS and agent commands, supporting the relatively high software-factory score.

## 2B. Hardware, operating system, cloud and data foundation

| ID      | Infrastructure family                       | Complete target                                                                                           | Current Simple state and largest gap                                                                                             |    F/U/P |    Done |
| ------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------: | ------: |
| **I10** | CPU, accelerator and hardware toolchain     | RISC-V CPU, GPU, DSP, NPU, FPGA, RTL generation, simulation, verification and hardware debugging          | Real RISC-V/VHDL/GPU work exists; ISA closure, production RTL evidence and accelerator completeness remain open                  | 42/24/35 | **36%** |
| **I11** | General OS and hypervisor                   | Exokernel/L4 services, POSIX, SMP, process, VM, container, device, desktop/server and virtualization      | Multi-architecture boot, VFS, GUI, networking, shell and services exist; broad hardware and OS feature parity remain incomplete  | 48/30/42 | **42%** |
| **I12** | Embedded, RTOS and specialized OS profiles  | Tiny, hard-real-time, safety, vehicle, industrial, flight, sensor and enclave profiles                    | Bare-metal and embedded paths are meaningful; deterministic scheduling and complete safety/flight profiles are still required    | 45/28/45 | **41%** |
| **I13** | HAL, drivers, firmware and device lifecycle | Uniform device model, BSPs, buses, drivers, firmware update, diagnostics and hardware-in-loop             | NVMe and several device paths are substantial; broad driver/BSP ecosystem is missing                                             | 38/23/38 | **34%** |
| **I14** | Storage and filesystem platform             | VFS, NVFS, DBFS, local/distributed FS, object/block storage, snapshots, replication, backup and DR        | VFS/NVFS/DBFS/WAL work exists; distributed/object/block services and complete backup/DR are absent                               | 38/24/40 | **35%** |
| **I15** | Networking and protocol platform            | Ethernet through application protocols, DNS, TLS, HTTP/2/3, QUIC, VPN, SDN, LB, firewall and mesh         | TCP/IP, SSH, HTTP and related modules exist; protocol coverage and production network control plane remain incomplete            | 40/24/40 | **36%** |
| **I16** | Security, IAM and software supply chain     | Crypto, PKI, authentication, IAM, RBAC/ABAC, secrets, sandbox, SIEM, EDR, DLP, SBOM and signing           | Crypto, RBAC, capabilities and policy pieces exist; unified identity, key/secrets and security operations platforms are missing  | 35/22/42 | **33%** |
| **I17** | Observability, diagnostics and replay       | Correlated logs, metrics, traces, profiles, crashes, audit, replay and business/physical telemetry        | Strong tracing/debug/replay concepts exist; a unified fleet-scale backend and standard signal model remain incomplete            | 45/32/48 | **42%** |
| **I18** | Database engine and server                  | Embedded and networked SQL, KV, document, graph, time-series, transactions, optimizer, replication and HA | Textual DB, pure SQL/MVCC, DBFS, network server and PostgreSQL compatibility surfaces exist; query/scale/HA parity is incomplete | 32/18/28 | **28%** |
| **I19** | Data, search and analytics platform         | Stream, CDC, FTS, vector, graph, OLAP, warehouse, lakehouse, ETL, catalog, lineage and BI                 | FTS, vector and offload components exist; full streaming, warehouse, governance and analytics platform is missing                | 22/12/22 | **20%** |
| **I20** | Messaging, event and workflow platform      | Queue, pub/sub, log, durable workflow, rules, state machine, saga, timer, approval and event processing   | State machines, outbox and workflow pieces exist; a general durable event/workflow engine is not complete                        | 32/20/30 | **29%** |
| **I21** | Distributed-systems substrate               | Consensus, membership, discovery, clocks, leases, sharding, replication and distributed transactions      | Scattered distributed concepts exist; no complete general cluster substrate yet                                                  |  15/8/18 | **14%** |
| **I22** | Cloud, containers and orchestration         | OCI images/runtime/registry, VM, scheduler, autoscaling, serverless, private cloud and edge management    | Container namespace, storage and checkpoint pieces exist; full OCI/Kubernetes/OpenStack-class control plane is absent            |  14/8/18 | **13%** |
| **I23** | Web, API and integration platform           | HTTP server, framework, gateway, REST/RPC/GraphQL, connectors, EDI, webhooks and API management           | Web framework/server/routes exist; protocol breadth, high-scale hosting and integration-platform functionality are incomplete    | 24/15/25 | **22%** |

The DB implementation is broader than its small headline server count suggests: Simple documents a textual WAL-backed DB, an embedded SQL/MVCC family and a networked multi-user server with sessions, capabilities, transactions and commit-before-ack durability. It is nevertheless far from the combined breadth of SQLite, PostgreSQL, Redis, ClickHouse, Kafka and modern data-platform tooling.

For the target external boundaries, OCI defines runtime, image and distribution specifications; SLSA defines incremental software-supply-chain guarantees; and OpenTelemetry now organizes traces, metrics, logs, baggage and profiles as correlated signals. ([Open Container Initiative][2])

## 2C. User experience, documents, AI and scientific computing

| ID      | Infrastructure family                       | Complete target                                                                                                        | Current Simple state and largest gap                                                                                                                |    F/U/P |    Done |
| ------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ------: |
| **I24** | Browser and web platform                    | HTML, CSS, DOM, JS, WASM, Fetch, storage, workers, media, graphics, accessibility, DevTools and isolation              | Strong selected rendering corpus; JS wiring, networking, storage, media, multiprocess security and broad WPT/Test262 coverage remain missing        | 32/20/30 | **29%** |
| **I25** | UI, TUI, GUI, accessibility and i18n        | Unified declarative UI, widgets, layouts, styling, accessibility, localization, input and desktop/web/mobile backends  | Broad UI/TUI/GUI/render work exists; polished accessibility, web parity and complete application shell remain unfinished                            | 60/42/58 | **55%** |
| **I26** | 2D, 3D, scene, game and XR graphics         | CPU/SIMD/GPU render, scene graph, text, animation, physics-facing rendering, shaders and XR                            | Multiple backends and substantial engine code exist; complete scene/game/XR stack and broad measured parity remain open                             | 50/32/58 | **47%** |
| **I27** | Image, audio, video and media pipeline      | Codecs, containers, capture, playback, streaming, DSP, DAW primitives, editing and composition                         | Some format/render/audio components exist; FFmpeg/GStreamer/DAW-class breadth is mostly missing                                                     |  15/8/22 | **15%** |
| **I28** | Document, Office and collaboration platform | Document model, formats, layout, comments, versions, coauthoring, search, permission and offline operation             | Writer/Calc/Slides and auxiliary applications exist; product assembly, fidelity and collaboration services remain incomplete                        | 45/26/32 | **38%** |
| **I29** | Universal enterprise/application kernel     | Identity, tenant, organization, money, catalog, order, inventory, asset, case, schedule, workflow, audit and reporting | Many real modules exist, but authorization, accounting, storage, data binding and shared UI remain fragmented                                       | 35/20/28 | **30%** |
| **I30** | AI, ML and agent platform                   | Tensor, autograd, training, inference, model compiler, serving, RAG, vector retrieval, eval, agents and governance     | Pure Simple tensors/autograd/layers/training plus PyTorch FFI and Caret exist; full model ecosystem and distributed serving/training are incomplete | 50/35/45 | **45%** |
| **I31** | Mathematics, science and HPC                | Arrays, BLAS/LAPACK, sparse, symbolic, statistics, optimization, ODE/PDE, MPI and scientific visualization             | Math syntax, ndarray and BLAS/LAPACK interfaces exist; SciPy/MATLAB/Mathematica-class breadth is incomplete                                         | 42/28/48 | **40%** |

The browser roadmap reports complete results for a selected 132-case pixel corpus and Acid2, while explicitly listing major unfinished areas such as full HTML/CSS, JavaScript event-loop integration, networking, WebGL/WebGPU, storage, media, multiprocess isolation, accessibility and broad conformance suites.

The ML guide documents Pure Simple tensors, autograd, common layers, optimizers, training, metrics, LoRA and PyTorch FFI. That is a meaningful ML foundation, but it is not yet equivalent to the full PyTorch/JAX/ONNX/MLOps ecosystem.

WHATWG’s HTML standard illustrates why browser completion remains a very large undertaking: it covers document semantics, user interaction, loading, application APIs, communications, workers, worklets, storage and rendering, with Fetch supplying a common resource-loading architecture. ([HTML Living Standard][3])

## 2D. Engineering and physical-world foundation

| ID      | Infrastructure family                           | Complete target                                                                                                   | Current Simple state and largest gap                                                                                    |    F/U/P |    Done |
| ------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------: | ------: |
| **I32** | Simulation, multiphysics, digital twin and HIL  | Discrete event, rigid/soft body, fluid, thermal, EM, optics, acoustics, chemistry, orbital and co-simulation      | Research and partial physics components exist; complete solver families, FMI exchange and HIL orchestration are missing |  15/8/18 | **14%** |
| **I33** | Control, navigation, sensor fusion and robotics | Real-time control, PID/MPC, estimation, coordinates, localization, SLAM, motion and autonomy graph                | Early foundations and research only; no complete ROS/control/navigation product surfaced in the audit                   |    8/4/— |  **7%** |
| **I34** | CAD, CAE, CAM, EDA, PLM and MBSE                | Geometry, constraints, FEA, CFD, electronics, PCB, RTL, CNC, requirements, BOM and lifecycle                      | RISC-V/VHDL and scattered engineering code provide an entry point; the general engineering suite is largely future work |  14/8/18 | **13%** |
| **I35** | Industrial, PLC, SCADA and MES                  | IEC control languages, deterministic runtime, fieldbus, OPC UA, HMI, MES, machine vision and safety               | No integrated industrial product surfaced; this remains one of the clearest major gaps                                  |    8/4/— |  **7%** |
| **I36** | GIS, mapping, terrain, ocean and weather        | Coordinates, projections, vector/raster, routing, terrain, hydrography, weather and spatial databases             | Units and scattered geographic foundations exist; complete GIS and Earth-data platform is absent                        |  10/6/12 |  **9%** |
| **I37** | Communications and collaboration                | Mail, calendar, contacts, chat, channels, voice, video, WebRTC, presence and federation                           | Mail/planner and agent messaging pieces exist; full protocol and collaboration-service coverage remains incomplete      | 20/12/22 | **18%** |
| **I38** | Universal resource and control plane            | Common identity, schema, config, state, event, policy, lifecycle, cost and audit for software and physical assets | Capability/config/state ideas exist in several subsystems; no single universal control plane yet connects them          | 18/10/20 | **16%** |

The target physical architecture should use open interoperability boundaries instead of inventing isolated vehicle-specific stacks:

* ROS 2 separates continuous topics, short request/response services and long-running actions. ([ROS Documentation][4])
* FMI standardizes model exchange and co-simulation, including scheduled execution and synchronized model components. ([FMI Standard][5])
* OPC UA companion specifications provide reusable, machine-readable information models for particular industries and machines. ([OPC Foundation][6])
* AUTOSAR divides deeply embedded vehicle functions and high-performance adaptive applications into standardized platforms. ([AUTOSAR][7])
* NASA cFS demonstrates the correct separation of platform support, OS abstraction, flight executive and mission applications; NASA reports its use across more than 40 missions. ([Goddard Engineering][8])

### Infrastructure-list result

Using equal category weights:

| Measure                                             | Current estimate |
| --------------------------------------------------- | ---------------: |
| Feature coverage                                    |          **40%** |
| Usability parity                                    |          **27%** |
| Performance parity among implemented infrastructure |          **39%** |
| Composite completion                                |          **37%** |

The two most important conclusions are:

1. **Simple already has a large portion of the conceptual and programming foundation.**
2. **The missing work is concentrated in integration platforms, deep libraries, cloud/data infrastructure and physical-domain engines.**

Treating every row in both lists equally gives an overall composite of approximately **27%**. That is not a schedule estimate. It describes a project with a comparatively advanced core surrounded by many lightly implemented or empty domains.

---

# Universal Application Kernel

This is the mechanism by which education, government, healthcare, commerce and dozens of other subjects can reuse the enterprise suite instead of becoming separate implementations.

Every information-oriented product should be composed from the following canonical entities and services:

```text
Identity
├── Person
├── Organization
├── Tenant
├── Team
├── Role
├── Policy
└── Credential

Work
├── Task
├── Workflow
├── Approval
├── Case
├── Project
├── Schedule
└── Booking

Business
├── Money
├── Ledger
├── Budget
├── Product
├── Service
├── Catalog
├── Contract
├── Order
├── Invoice
├── Payment
├── Inventory
├── BOM
└── Work order

Information
├── Document
├── Record
├── Message
├── Comment
├── Version
├── Search index
├── Report
├── Dashboard
└── Notification

Physical world
├── Asset
├── Device
├── Location
├── Geometry
├── Measurement
├── Unit
├── Event
├── Time series
├── Model
└── Digital twin

Engineering evidence
├── Requirement
├── Design
├── Test
├── Result
├── Hazard
├── Trace
└── Provenance
```

Domain packs should add only five kinds of material:

1. **Domain vocabulary and schemas**
2. **Domain calculations and algorithms**
3. **Domain protocols and file formats**
4. **Domain workflows and UI views**
5. **Domain conformance and assurance tests**

Examples:

```text
Education pack
├── Course
├── Enrollment
├── Assignment
├── Assessment
├── Grade
├── Competency
└── Credential

Healthcare pack
├── Patient
├── Encounter
├── Observation
├── Medication
├── Procedure
├── Diagnostic image
└── Clinical terminology

Aerospace pack
├── Vehicle
├── Flight plan
├── Navigation state
├── Guidance command
├── Control surface
├── Engine
├── Fault response
└── Mission timeline
```

FHIR already demonstrates the resource-composition approach for healthcare. LTI, OneRoster and QTI define boundaries for education tools, roster/grade exchange and assessment content. CCSDS does the same for interoperable space communications and mission systems, while IHO S-100 defines a reusable hydrographic and maritime data framework. ([HL7][9])

---

# Master dependency map

```text
I01 Language
 │
 ├── I02 Compiler and backends
 ├── I03 Runtime and concurrency
 ├── I04 Standard library
 ├── I05 Interoperability
 ├── I06 Build and packages
 ├── I07 Verification
 └── I08 IDE and debugger
          │
          ▼
I10 Hardware ── I11 OS ── I12 RTOS ── I13 Devices
          │
          ├── I14 Storage
          ├── I15 Networking
          ├── I16 Security
          └── I17 Observability
                    │
                    ▼
          I18 Database
          I19 Data platform
          I20 Workflow/events
          I21 Distributed systems
          I22 Cloud
          I23 Web/API
                    │
                    ▼
          I24 Browser
          I25 UI
          I26 Graphics
          I27 Media
          I28 Documents
          I29 Application kernel
          I30 AI/agents
                    │
                    ▼
          I31 Math/HPC
          I32 Simulation/twin
          I33 Control/robotics
          I34 Engineering/PLM
          I35 Industrial
          I36 GIS/Earth
                    │
                    ▼
              A01–A31 domain packs

I38 Universal Control Plane crosses every layer.
```

No domain application should directly bypass this dependency structure.

For example:

```text
Deep-space robot =
    I10 radiation-tolerant compute
  + I12 flight RTOS
  + I13 devices
  + I15 space communications
  + I17 telemetry
  + I30 onboard AI
  + I31 orbital/scientific math
  + I32 mission simulation
  + I33 navigation/robotics
  + I38 mission control plane
  + A23 spacecraft pack
  + A24 deep-space pack
```

---

# Full future implementation program

## Wave 0 — Truthful capability registry

Create one authoritative `World Software Capability Registry`.

Each entry should contain:

```text
id
family
capability
reference_products
reference_standards
dependencies
feature_score
usability_score
performance_score

state:
    declared
    source_present
    unit_verified
    integration_verified
    system_verified
    interoperable
    end_to_end_usable
    performance_parity

evidence:
    source_revision
    spec_receipt
    test_receipt
    benchmark_receipt
    verified_targets
    known_gaps
```

This solves the existing problem where source presence or an `implemented: true` flag can overstate actual product completion. The Office/enterprise audit recommends an evidence-bearing maturity model for this reason.

### Exit gate

Every public feature claim must resolve to executable evidence or be clearly marked as planned.

---

## Wave 1 — Close the programming foundation

Primary rows:

```text
I01–I09
```

Required work:

* backend and runtime feature-parity matrix
* complete standard-library taxonomy
* canonical APIs across GC/no-GC and sync/async families
* FFI contract verification
* package lockfiles and registry
* hermetic and reproducible builds
* remote/distributed build cache
* complete LSP/DAP/refactoring paths
* one actual IDE/workbench entry point
* code forge, issue, review and CI foundation
* conformance, fuzz and benchmark farms

### Exit gate

A nontrivial Simple application can be developed, tested, profiled, packaged, published and deployed without relying on an unrelated outside language toolchain except for explicitly supported interoperability.

---

## Wave 2 — Complete the machine and OS substrate

Primary rows:

```text
I10–I17
```

Required work:

* RISC-V profile truth closure
* MMU, cache, interrupt, multicore and debug completion
* host, SimpleOS, embedded and RTOS target parity
* universal HAL/device model
* driver and BSP SDK
* firmware update/rollback
* object, capability and process isolation
* immutable images and recovery
* unified identity, signing and attestation
* logs, metrics, traces, profiles and replay with common context
* resource, energy and memory accounting

### Exit gate

The same application capsule runs on host Linux, SimpleOS, embedded Simple and a Simple RISC-V target with target-appropriate configuration rather than source forks.

---

## Wave 3 — Build data and serving foundations

Primary rows:

```text
I18–I23
```

Required work:

* complete SQL semantics and optimizer
* transaction/concurrency test suites
* replication and high availability
* document/KV/graph/time-series adapters
* search and vector indexing
* streaming log and event bus
* durable workflow engine
* API gateway and integration connectors
* multi-tenant identity and policy
* migration, backup and point-in-time recovery
* standard HTTP/2, HTTP/3, QUIC and WebSocket support
* workload benchmarks against relevant reference systems

### Exit gate

A multi-user application can run entirely on Simple’s database, web, policy, messaging and storage platform with no SQLite-emulation shortcuts.

---

## Wave 4 — Build distributed cloud and universal control

Primary rows:

```text
I21, I22, I38
```

Required work:

* membership and service discovery
* consensus and leases
* scheduler and resource placement
* container runtime, image and registry
* VM/hypervisor management
* storage and network provisioning
* rolling update and rollback
* autoscaling
* secrets/config distribution
* metering, quota and cost
* private-cloud and edge control
* unified software/device/robot/factory resource graph

### Exit gate

Simple can deploy and manage a service across several machines, detect failures, move workloads, preserve data and expose the same resources to Caret under capability policy.

OCI conformance should define the container boundary rather than a Simple-only image format. ([Open Container Initiative][2])

---

## Wave 5 — Assemble the universal application platform

Primary rows:

```text
I24–I30
```

Required work:

* shared IDE/Office/enterprise/browser workbench
* document repository and versioning
* permissions, comments, review and coauthoring
* offline operation and synchronization
* universal search
* identity, organization and tenant kernel
* canonical workflow, notification and audit
* canonical money/ledger service
* canonical product/order/inventory model
* forms, tables, dashboards and report designer
* enterprise data binding
* agent-safe command and writeback model
* desktop, web, TUI and SimpleOS profiles

### First required vertical

```text
CRM lead
→ opportunity
→ Calc quotation
→ Writer proposal
→ approval
→ sales order
→ inventory reservation
→ invoice
→ payment
→ general ledger
→ audit and observability trace
```

This one path exercises almost every reusable business component.

### Exit gate

Office and enterprise cease being collections of local modules and become one integrated multi-user product platform.

---

## Wave 6 — Complete science and engineering infrastructure

Primary rows:

```text
I31, I32, I34, I36
```

Required work:

* dense and sparse arrays
* statistics and optimization
* symbolic mathematics
* ODE/PDE solvers
* rigid, soft, fluid, thermal, electromagnetic, acoustic and orbital simulation
* FMI import/export and co-simulation master
* geometry and constraint kernel
* CAD document model
* FEA/CFD integration
* schematic/PCB/SPICE
* RTL/simulation/synthesis integration
* requirements, BOM, revisions and PLM
* GIS, terrain, ocean and atmospheric models
* scientific notebooks and visualization

### Exit gate

A system can move through:

```text
requirement
→ design model
→ simulation
→ generated software/RTL
→ hardware-in-loop test
→ verification evidence
→ manufacturing BOM
```

without disconnected duplicate representations.

---

## Wave 7 — Complete control, robotics and industry

Primary rows:

```text
I33, I35
```

Required work:

* hard-real-time scheduler and WCET interfaces
* typed sensor/actuator model
* PID, state-space and MPC
* Kalman and other estimation filters
* coordinate/reference-frame library
* route, trajectory and motion planning
* ROS-like node/topic/service/action graph
* PLC languages and deterministic scan runtime
* HMI and SCADA
* OPC UA server/client and companion models
* industrial Ethernet and fieldbus
* MES, recipe, quality and maintenance
* machine vision
* simulation/HIL/physical interchangeable drivers

### First required physical vertical

```text
ERP production order
→ MES schedule
→ PLC recipe
→ robot operation
→ machine-vision inspection
→ quality record
→ inventory update
→ accounting update
→ complete digital-twin trace
```

### Exit gate

The same control program runs against simulation, HIL and a physical factory cell with explicit target configuration.

---

## Wave 8 — High-reuse domain packs

Implement the information-oriented domains first because they reuse the greatest fraction of the UAK:

```text
A03 Commerce
A04 Education
A06 Government/legal
A08 Logistics
A09 Consumer/home
A27 Built world
A28 Agriculture
```

Each domain pack must provide:

* semantic model
* domain validation rules
* reference workflows
* standards adapters
* UI profile
* report/dashboard set
* system examples
* conformance tests

Education should target LTI, OneRoster and QTI boundaries rather than inventing incompatible exchange formats. ([1EdTech][10])

---

## Wave 9 — Algorithmically and regulatorily deep domains

Then implement:

```text
A05 Healthcare
A07 Finance
A15 Semiconductor
A25 Energy
A26 Process industries
A29 Telecom
A30 Science
```

These reuse the application platform but need deep domain engines.

Examples:

* healthcare terminology, clinical model and imaging
* financial risk and matching engines
* semiconductor timing, verification and physical design
* grid and plant simulation/control
* reservoir and process simulation
* RF, DSP and cellular networking
* scientific domain solvers

FHIR should be an external healthcare interoperability boundary. OPC UA companion models should serve industrial semantic interoperability. ([HL7][11])

---

## Wave 10 — Mobility, ocean, aerospace and space

Implement these through shared vehicle primitives rather than one isolated stack per vehicle.

### Shared Vehicle Platform

```text
Vehicle
├── power
├── propulsion
├── thermal
├── structure
├── communication
├── navigation
├── guidance
├── control
├── payload
├── health
├── maintenance
└── mission
```

### Shared Navigation Platform

```text
Reference frame
Coordinates
Clock/time
Map/environment
GNSS
INS
Sensor fusion
Localization
Route planning
Trajectory
Obstacle/hazard model
```

Then specialize:

```text
Land      → automobile, rail, mining vehicle
Surface   → ship, autonomous vessel
Underwater→ submarine, AUV, ROV
Air       → airplane, helicopter, UAV
Orbit     → satellite, station, launch vehicle
Deep space→ probe, rover, autonomous science robot
```

NASA cFS and CCSDS should be treated as major spacecraft completeness references; AUTOSAR should inform vehicle software separation; IHO S-100 should define maritime and hydrographic interoperability. ([Goddard Engineering][8])

---

## Wave 11 — Civilization-scale integration demonstrators

These are not separate foundational stacks. They are end-to-end tests of the entire map.

| Demonstrator                          | Infrastructure and subjects exercised                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| **Autonomous semiconductor fab**      | EDA, fab MES, PLC, robotics, vision, ERP, AI and digital twin                      |
| **Autonomous container port**         | Ships, cranes, AGVs, logistics, customs, weather and scheduling                    |
| **Scientific AUV mission**            | Ocean model, sonar, autonomy, navigation, communication and mission control        |
| **Electric autonomous aircraft**      | CAD/CAE, battery, avionics, control, navigation and certification evidence         |
| **CubeSat and ground station**        | RISC-V, flight RTOS, CCSDS, ADCS, radio, mission planning and telemetry            |
| **Reusable launch vehicle simulator** | Propulsion, GNC, stage control, CFD, HIL and ground systems                        |
| **Mars rover**                        | Deep-space communication, autonomy, SLAM, energy scheduling and scientific payload |
| **Europa cryobot**                    | Spacecraft, ice/thermal model, deep ocean, autonomy and delayed communication      |
| **Lunar base**                        | Habitat, energy, mining, manufacturing, robotics, logistics, health and ERP        |
| **Earth digital twin**                | Weather, ocean, GIS, cities, energy, transport and environmental models            |
| **Fusion plant twin**                 | Plasma/scientific computing, thermal/fluid, industrial control and safety          |
| **Generation ship simulation**        | Space, habitat, energy, agriculture, health, manufacturing, education and economy  |

A demonstrator is accepted only when it uses the shared infrastructure. A local one-off simulation does not count as completion.

---

# Architecture rules that keep the plan manageable

## 1. No duplicate universal services

No domain may create its own independent:

```text
identity
authorization
money
document
workflow
notification
search
audit
telemetry
storage
device model
simulation exchange
```

A domain may extend these services but not fork them.

## 2. Separate internal models from compatibility adapters

Use:

```text
Simple canonical model
        ↓
compatibility adapter
        ↓
FHIR / OPC UA / AUTOSAR / CCSDS / S-100 / OCI / external API
```

Do not shape every internal object around one outside standard.

## 3. Use three product sizes

Every important platform should support:

```text
tiny
    minimal embedded/static implementation

standard
    normal desktop/server implementation

distributed
    cloud/cluster implementation
```

All three share interfaces and conformance tests.

## 4. Measure all three requested axes independently

Every capability needs:

```text
Feature gate
    conformance and functional tests

Usability gate
    end-to-end executable workflow

Performance gate
    representative benchmark and budget
```

Passing unit tests alone does not earn a high completion score.

## 5. Build vertical slices, not horizontal stubs

Bad progression:

```text
100 products each with a launcher and five placeholder screens
```

Correct progression:

```text
one complete transaction or mission
across every required layer
```

Recommended first slices:

1. Software issue → agent → code → test → review → release.
2. CRM opportunity → quotation → order → invoice → ledger.
3. Factory order → PLC/robot → inspection → inventory.
4. CubeSat command → onboard execution → telemetry → ground display.
5. Deep-space robot intent → onboard planning → simulated execution → delayed result.

---

# Final completion assessment

| Map                                           |       Feature |     Usability | Performance where implemented |     Composite |
| --------------------------------------------- | ------------: | ------------: | ----------------------------: | ------------: |
| **Simple language semantics**                 |      **100%** |       **80%** |                       **70%** |       **89%** |
| **Infrastructure/framework/library/tool map** |       **40%** |       **27%** |                       **39%** |       **37%** |
| **Application and subject map**               |       **17%** |       **10%** |                       **29%** |       **15%** |
| **Both maps, equal-category aggregate**       | about **30%** | about **20%** |                        uneven | about **27%** |

The correct immediate order is therefore:

```text
1. Capability/evidence registry
2. Standard library, package/build and execution-path parity
3. OS/device/storage/network/security/observability closure
4. Database, web, data, messaging and cloud control plane
5. Universal application kernel and shared workbench
6. Scientific computing, simulation and engineering platform
7. Control, robotics, PLC and industrial platform
8. High-reuse information-domain packs
9. Deep algorithmic domains
10. Automotive, marine, aerospace, space and deep-space systems
11. Civilization-scale integration demonstrations
```

The critical strategic shift is that **education, healthcare, finance, government, logistics and similar subjects should not each become another standalone enterprise suite**. They should become domain packs over one Universal Application Kernel. Similarly, ships, submarines, aircraft, rockets and deep-space robots should be compositions of one shared engineering, simulation, vehicle, navigation, control and mission platform.

That composition model is the only architecture that allows the Simple project to approach coverage of the world’s major software classes without turning into thousands of unrelated implementations.

[1]: https://landscape.cncf.io/ "https://landscape.cncf.io/"
[2]: https://opencontainers.org/ "https://opencontainers.org/"
[3]: https://html.spec.whatwg.org/multipage/ "https://html.spec.whatwg.org/multipage/"
[4]: https://docs.ros.org/en/humble/Concepts/Basic/Interfaces-Topics-Services-Actions.html "https://docs.ros.org/en/humble/Concepts/Basic/Interfaces-Topics-Services-Actions.html"
[5]: https://fmi-standard.org/docs/3.0.2/ "https://fmi-standard.org/docs/3.0.2/"
[6]: https://opcfoundation.org/about/opc-technologies/opc-ua/ua-companion-specifications/ "https://opcfoundation.org/about/opc-technologies/opc-ua/ua-companion-specifications/"
[7]: https://www.autosar.org/standards/classic-platform "https://www.autosar.org/standards/classic-platform"
[8]: https://etd.gsfc.nasa.gov/capabilities/core-flight-system/ "https://etd.gsfc.nasa.gov/capabilities/core-flight-system/"
[9]: https://www.hl7.org/fhir/overview.html "https://www.hl7.org/fhir/overview.html"
[10]: https://www.1edtech.org/standards/lti "https://www.1edtech.org/standards/lti"
[11]: https://hl7.org/fhir/overview-dev.html "https://hl7.org/fhir/overview-dev.html"
