---- MODULE CommandTracking ----------------------------------------------------
EXTENDS Naturals

CONSTANTS ExactEnd, SessionGuard, KeepNews, NoFalseSuccess,
          ViewUsesPhase, PreserveStale, RestoreGuard
VARIABLES session, owner, phase, pending, produced, delivered, restored,
          falseSuccess, foreignAccepted, lost, done, terminalBusy, leaked,
          stale, wrongRestore
vars == <<session, owner, phase, pending, produced, delivered, restored,
          falseSuccess, foreignAccepted, lost, done, terminalBusy,
          leaked, stale, wrongRestore>>
Init == /\ session = 1 /\ owner = 1 /\ phase = "confirm"
        /\ pending = 0 /\ produced = 0 /\ delivered = 0
        /\ restored = FALSE /\ falseSuccess = FALSE
        /\ foreignAccepted = FALSE /\ lost = FALSE /\ done = FALSE
        /\ terminalBusy = FALSE /\ leaked = FALSE /\ stale = FALSE
        /\ wrongRestore = FALSE
Approve == /\ phase = "confirm" /\ phase' = "running"
           /\ terminalBusy' = TRUE
           /\ UNCHANGED <<session, owner, pending, produced, delivered,
                          restored, falseSuccess, foreignAccepted, lost, done,
                          leaked, stale, wrongRestore>>
Timeout == /\ phase = "running" /\ phase' = "background"
           /\ falseSuccess' = (falseSuccess \/ ~NoFalseSuccess)
           /\ UNCHANGED <<session, owner, pending, produced, delivered,
                          restored, foreignAccepted, lost, done, terminalBusy,
                          leaked, stale, wrongRestore>>
End(matching) == /\ phase = "background" /\ terminalBusy
                 /\ IF matching \/ ~ExactEnd
                    THEN /\ terminalBusy' = FALSE /\ phase' = "ended"
                         /\ foreignAccepted' = (foreignAccepted \/ ~matching)
                         /\ IF session = owner \/ ~SessionGuard
                            THEN /\ pending' = pending + 1
                                 /\ produced' = produced + 1
                                 /\ leaked' = (leaked \/ session # owner)
                            ELSE UNCHANGED <<pending, produced, leaked>>
                    ELSE UNCHANGED <<terminalBusy, phase, foreignAccepted,
                                     pending, produced, leaked>>
                 /\ UNCHANGED <<session, owner, delivered, restored,
                                falseSuccess, lost, done, stale, wrongRestore>>
Report == /\ pending > 0 /\ pending' = pending - 1
          /\ delivered' = delivered + 1 /\ restored' = TRUE
          /\ UNCHANGED <<session, owner, phase, produced, falseSuccess,
                         foreignAccepted, lost, done, terminalBusy, leaked,
                         stale, wrongRestore>>
Restore == /\ restored /\ restored' = FALSE
           /\ stale' = (stale \/ ~PreserveStale)
           /\ wrongRestore' = (wrongRestore \/
                (session # owner /\ ~RestoreGuard))
           /\ IF session # owner /\ RestoreGuard
              THEN UNCHANGED <<pending, delivered, lost>>
              ELSE IF KeepNews THEN /\ pending' = pending + 1
                                    /\ delivered' = delivered - 1
                                    /\ lost' = lost
                   ELSE /\ pending' = pending /\ delivered' = delivered - 1
                        /\ lost' = TRUE
           /\ UNCHANGED <<session, owner, phase, produced, falseSuccess,
                          foreignAccepted, done, terminalBusy, leaked>>
Replace == /\ session = 1 /\ session' = 2
           /\ UNCHANGED <<owner, phase, pending, produced, delivered,
                          restored, falseSuccess, foreignAccepted, lost, done,
                          terminalBusy, leaked, stale, wrongRestore>>
Finish == /\ phase = "ended" /\ done' = TRUE
          /\ UNCHANGED <<session, owner, phase, pending, produced, delivered,
                         restored, falseSuccess, foreignAccepted, lost,
                         terminalBusy, leaked, stale, wrongRestore>>
Next == Approve \/ Timeout \/ (\E matching \in BOOLEAN: End(matching))
        \/ Report \/ Restore \/ Replace \/ Finish
Spec == Init /\ [][Next]_vars /\ WF_vars(Report) /\ WF_vars(Finish)
TypeOK == /\ session \in {1, 2} /\ owner = 1
          /\ phase \in {"confirm", "running", "background", "ended"}
          /\ pending \in 0..1 /\ produced \in 0..1 /\ delivered \in 0..1
          /\ restored \in BOOLEAN /\ falseSuccess \in BOOLEAN
          /\ foreignAccepted \in BOOLEAN /\ lost \in BOOLEAN
          /\ done \in BOOLEAN /\ terminalBusy \in BOOLEAN /\ leaked \in BOOLEAN
          /\ stale \in BOOLEAN /\ wrongRestore \in BOOLEAN
View == IF ViewUsesPhase
        THEN IF phase = "confirm" THEN "confirm"
             ELSE IF phase \in {"running", "background"} THEN "running"
             ELSE "none"
        ELSE "running"
AccurateView == /\ (phase = "confirm" => View = "confirm")
                /\ (phase \in {"running", "background"} => View = "running")
InformationalRestore == ~stale
NoInventedSuccess == ~falseSuccess
MatchingExecution == ~foreignAccepted
SessionIsolated == ~leaked
RestoreIsolated == ~wrongRestore
Conservation == produced = pending + delivered
EventuallyReported == pending > 0 ~> pending = 0
================================================================================
