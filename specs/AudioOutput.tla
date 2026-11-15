---- MODULE AudioOutput --------------------------------------------------------
(***************************************************************************)
(* A single native output process, with asynchronous start and close.     *)
(* Output and page epochs invalidate stale callbacks. Retirement retains  *)
(* ownership until process close. Only a natural close reports ended.     *)
(* When a verified native helper exists (macOS, #82), the system default  *)
(* plays through it as target "sys"; the browser default is the fallback  *)
(* used only when no helper can run. On Linux (#84) the "helper" is       *)
(* PipeWire with a known default sink, which can appear or disappear at   *)
(* any time (`HelperChange`), so each route is decided when it is admitted.*)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardCurrent, GuardTarget, GuardRetire, GuardPaused, GuardNatural,
    GuardDefault, GuardHelper, GuardAdmit

VARIABLES phase, generation, epoch, page, selected, requestEpoch,
          requestPage, target, actual, valid, owned, paused, outcome,
          reading, approval, canceledEnd, live, actualJob, badExit, defaultBusy,
          helper, defaultHelper, sysHelper
vars == <<phase, generation, epoch, page, selected, requestEpoch,
          requestPage, target, actual, valid, owned, paused, outcome,
          reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy, helper, defaultHelper, sysHelper>>
Routes == {"a", "b", "sys"}

TypeOK ==
    /\ phase \in {"idle", "starting", "playing", "paused", "retiring"}
    /\ generation \in 0..2 /\ epoch \in 0..2 /\ page \in 0..2
    /\ selected \in {"a", "b"} /\ target \in Routes
    /\ actual \in {"none"} \cup Routes /\ requestEpoch \in 0..2
    /\ requestPage \in 0..2 /\ valid \in BOOLEAN /\ owned \in BOOLEAN
    /\ paused \in BOOLEAN /\ outcome \in {"none", "ended", "canceled"}
    /\ reading \in BOOLEAN /\ approval \in BOOLEAN
    /\ canceledEnd \in BOOLEAN /\ live \in 0..1
    /\ actualJob \in 0..2 /\ badExit \in BOOLEAN
    /\ defaultBusy \in BOOLEAN /\ helper \in BOOLEAN
    /\ defaultHelper \in BOOLEAN /\ sysHelper \in BOOLEAN

Init ==
    /\ phase = "idle" /\ generation = 0 /\ epoch = 0 /\ page = 0
    /\ selected = "a" /\ requestEpoch = 0 /\ requestPage = 0
    /\ target = "a" /\ actual = "none" /\ valid = FALSE /\ owned = FALSE
    /\ paused = FALSE /\ outcome = "none" /\ reading = TRUE
    /\ approval = TRUE /\ canceledEnd = FALSE
    /\ live = 0 /\ actualJob = 0 /\ badExit = FALSE /\ defaultBusy = FALSE
    \* The packaged helper either verifies at startup or it does not.
    /\ helper \in BOOLEAN
    \* Whether a helper was usable when the browser default or the "sys"
    \* route was admitted.
    /\ defaultHelper = FALSE /\ sysHelper = FALSE

\* `route` is the selected device, or "sys", the system default through a
\* verified helper.
Reserve(route) ==
    /\ phase = "idle" /\ ~owned /\ ~paused /\ ~defaultBusy
    /\ generation < 2
    /\ route \in {selected, "sys"} /\ (~GuardAdmit \/ (route = "sys" => helper))
    /\ generation' = generation + 1 /\ requestEpoch' = epoch
    /\ requestPage' = page /\ target' = route /\ valid' = TRUE
    /\ owned' = TRUE /\ phase' = "starting" /\ outcome' = "none"
    /\ actual' = "none" /\ live' = 1 /\ actualJob' = 0
    /\ sysHelper' = (route = "sys" /\ helper)
    /\ UNCHANGED <<epoch, page, selected, paused, reading, approval,
                   canceledEnd, badExit, defaultBusy, helper, defaultHelper>>

Start(job) ==
    /\ job \in 1..2
    /\ phase = "starting" \/ (~GuardCurrent /\ phase = "retiring")
    /\ (~GuardCurrent \/ (valid /\ requestEpoch = epoch /\ requestPage = page /\
        job = generation))
    /\ (~GuardPaused \/ ~paused)
    /\ actual' \in IF GuardTarget THEN {target} ELSE Routes
    /\ phase' = "playing" /\ actualJob' = job
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, badExit, defaultBusy,
                   helper, defaultHelper, sysHelper>>

Pause ==
    /\ ~paused /\ paused' = TRUE
    /\ phase' = IF phase = "playing" THEN "paused" ELSE phase
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, outcome,
                   reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy, helper, defaultHelper, sysHelper>>

Resume ==
    /\ paused /\ paused' = FALSE
    /\ phase' = IF phase = "paused" THEN "playing" ELSE phase
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, outcome,
                   reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy, helper, defaultHelper, sysHelper>>

Cancel ==
    /\ owned /\ phase # "retiring" /\ valid' = FALSE
    /\ phase' = IF GuardRetire THEN "retiring" ELSE "idle"
    /\ outcome' = "canceled"
    /\ owned' = IF GuardRetire THEN owned ELSE FALSE
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, paused, reading,
                   approval, canceledEnd, live, actualJob, badExit,
                   defaultBusy, helper, defaultHelper, sysHelper>>

Change ==
    /\ epoch < 2 /\ epoch' = epoch + 1 /\ selected' \in {"a", "b"}
    /\ valid' = FALSE /\ phase' = IF owned THEN "retiring" ELSE "idle"
    /\ UNCHANGED <<generation, page, requestEpoch, requestPage, target,
                   actual, owned, paused, outcome, reading, approval,
                   canceledEnd, live, actualJob, badExit, defaultBusy, helper,
                   defaultHelper, sysHelper>>

Page ==
    /\ page < 2 /\ page' = page + 1 /\ valid' = FALSE
    /\ phase' = IF owned THEN "retiring" ELSE "idle"
    /\ UNCHANGED <<generation, epoch, selected, requestEpoch, requestPage,
                   target, actual, owned, paused, outcome, reading, approval,
                   canceledEnd, live, actualJob, badExit, defaultBusy, helper,
                   defaultHelper, sysHelper>>

Exit(job) ==
    /\ job \in 1..2 /\ (~GuardCurrent \/ job = generation)
    /\ owned /\ phase \in {"playing", "retiring"}
    /\ outcome' = IF phase = "playing" \/ ~GuardNatural
                  THEN "ended" ELSE "canceled"
    /\ canceledEnd' =
        (canceledEnd \/ (phase = "retiring" /\ outcome' = "ended"))
    /\ phase' = "idle" /\ owned' = FALSE /\ valid' = FALSE
    /\ live' = 0 /\ badExit' = (badExit \/ job # generation)
    /\ actual' = "none"
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, paused, reading, approval, actualJob,
                   defaultBusy, helper, defaultHelper, sysHelper>>

\* The browser default: only a fallback when no verified helper can run.
DefaultStart ==
    /\ ~defaultBusy /\ (~GuardDefault \/ live = 0)
    /\ (~GuardHelper \/ ~helper)
    /\ defaultBusy' = TRUE /\ defaultHelper' = helper
    /\ UNCHANGED <<phase, generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, actualJob, badExit,
                   helper, sysHelper>>

DefaultEnd ==
    /\ defaultBusy /\ defaultBusy' = FALSE
    /\ UNCHANGED <<phase, generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, actualJob, badExit,
                   helper, defaultHelper, sysHelper>>

\* PipeWire, or its default sink, appears or disappears (Linux, #84). A job
\* already admitted keeps its route; the next admission sees the new state.
HelperChange ==
    /\ helper' = ~helper
    /\ UNCHANGED <<phase, generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, actualJob, badExit,
                   defaultBusy, defaultHelper, sysHelper>>

Next == (\E route \in Routes: Reserve(route))
        \/ (\E job \in 1..2: Start(job)) \/ Pause \/ Resume
        \/ Cancel \/ Change \/ Page \/ (\E job \in 1..2: Exit(job))
        \/ DefaultStart \/ DefaultEnd \/ HelperChange
Spec == Init /\ [][Next]_vars /\ WF_vars(\E job \in 1..2: Start(job)) /\
        WF_vars(\E job \in 1..2: Exit(job))
NoRevival == phase = "playing" =>
    (valid /\ requestEpoch = epoch /\ requestPage = page /\
     actualJob = generation)
NoFallback == phase \in {"playing", "paused"} => actual = target
NoOverlap == owned = (live = 1)
NoCrossRouteOverlap == ~(live = 1 /\ defaultBusy)
NoStartPaused == phase = "playing" => ~paused
NoCanceledEnd == ~canceledEnd /\ ~badExit
IndependentGates == reading /\ approval
\* With a usable helper at admission, default speech never uses the browser
\* page (#82, #84).
NativeDefault == defaultBusy => ~defaultHelper
\* The system-default native route is admitted only while a helper is usable.
HelperRoute == (owned /\ target = "sys") => sysHelper
RetirementCompletes == (phase = "retiring") ~> ~owned
StartProgress == (phase = "starting" /\ ~paused /\ valid) ~>
                 (phase # "starting" \/ paused \/ ~valid)
================================================================================
