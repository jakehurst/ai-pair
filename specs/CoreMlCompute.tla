---- MODULE CoreMlCompute ------------------------------------------------------
(***************************************************************************)
(* Kokoro compute on a host whose only GPU path is ONNX Runtime's CoreML   *)
(* execution provider (macOS arm64, #42). GPU is offered only where that   *)
(* path exists; explicit GPU never falls back to the CPU; the backend is   *)
(* reported as GPU only after a CoreML session has loaded the model.       *)
(***************************************************************************)
VARIABLES capable, mode, model, phase, loads, actual, offered
vars == <<capable, mode, model, phase, loads, actual, offered>>

Modes == {"cpu", "auto", "gpu"}

TypeOK ==
    /\ capable \in BOOLEAN /\ mode \in Modes /\ model \in BOOLEAN
    /\ phase \in {"idle", "check", "loading", "ready", "failed"}
    /\ loads \in BOOLEAN /\ actual \in {"none", "cpu", "gpu"}
    /\ offered \in BOOLEAN

\* `capable`: the host has the CoreML path. `model`: the q8 model is
\* installed. `loads`: whether CoreML can create the session (the
\* environment's answer, fixed for a run).
Init ==
    /\ capable \in BOOLEAN /\ model \in BOOLEAN /\ loads \in BOOLEAN
    /\ offered = capable
    \* A saved setting can name GPU on any host, e.g. from another machine.
    /\ mode \in Modes
    /\ phase = "idle" /\ actual = "none"

\* The panel offers GPU and Auto only on a capable host.
Select(m) ==
    /\ phase \in {"idle", "ready", "failed"}
    /\ m \in IF offered THEN Modes ELSE {"cpu"}
    /\ mode' = m /\ phase' = "idle" /\ actual' = "none"
    /\ UNCHANGED <<capable, model, loads, offered>>

\* A narration acquires a backend.
Acquire ==
    /\ phase = "idle"
    /\ phase' = IF mode = "cpu" THEN "loading" ELSE "check"
    /\ UNCHANGED <<capable, mode, model, loads, actual, offered>>

\* The light check: the CoreML path exists and the model is installed.
Check ==
    /\ phase = "check"
    /\ IF capable /\ model THEN phase' = "loading"
       ELSE IF mode = "auto" THEN phase' = "loading"
       ELSE phase' = "failed"
    /\ UNCHANGED <<capable, mode, model, loads, actual, offered>>

\* The worker loads the model; under CoreML it reports ready only when the
\* CoreML session was created.
Load ==
    /\ phase = "loading"
    /\ LET gpu == mode # "cpu" /\ capable /\ model IN
       \* Auto falls back to the CPU only at the check; a CoreML session that
       \* fails to load fails the unit in either mode, and says so.
       IF gpu
       THEN IF loads THEN /\ phase' = "ready" /\ actual' = "gpu"
            ELSE /\ phase' = "failed" /\ actual' = "none"
       ELSE /\ phase' = "ready" /\ actual' = "cpu"
    /\ UNCHANGED <<capable, mode, model, loads, offered>>

Next == (\E m \in Modes : Select(m)) \/ Acquire \/ Check \/ Load
Spec == Init /\ [][Next]_vars /\ WF_vars(Acquire) /\ WF_vars(Check)
        /\ WF_vars(Load)

ExplicitNoFallback == mode = "gpu" => actual # "cpu"
GpuOnlyIfLoaded == actual = "gpu" => capable /\ model /\ loads /\ mode # "cpu"
OfferedOnlyWhereCapable == offered = capable
\* A host without the path cannot newly select GPU or Auto.
NoGpuSelectWithoutPath ==
    [][mode' # mode => (mode' = "cpu" \/ capable)]_vars
\* A saved GPU setting on such a host fails visibly; it never runs.
NoGpuWithoutPath == ~capable => actual # "gpu"
\* Something must happen: explicit GPU on a working CoreML host speaks on GPU.
GpuSpeaks ==
    (capable /\ model /\ loads /\ mode = "gpu" /\ phase = "idle")
        ~> (actual = "gpu" \/ mode # "gpu")
\* Every acquisition settles.
Settles == phase \in {"check", "loading"} ~> phase \in {"ready", "failed"}
================================================================================
