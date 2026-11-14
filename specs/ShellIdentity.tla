---- MODULE ShellIdentity ------------------------------------------------------
EXTENDS Naturals
CONSTANTS WaitForIdentity
VARIABLES shell, phase, submitted, wrapped, expired, stopped
vars == <<shell, phase, submitted, wrapped, expired, stopped>>
Init == /\ shell \in {"unknown", "bash", "other"}
        /\ phase = "idle" /\ submitted = FALSE
        /\ wrapped = FALSE /\ expired = FALSE /\ stopped = FALSE
Start == /\ phase = "idle"
         /\ phase' = IF shell = "unknown" /\ WaitForIdentity
                     THEN "waiting" ELSE "ready"
         /\ UNCHANGED <<shell, submitted, wrapped, expired, stopped>>
Identify == /\ phase = "waiting"
            /\ shell' \in {"bash", "other"} /\ phase' = "ready"
            /\ UNCHANGED <<submitted, wrapped, expired, stopped>>
Expire == /\ phase = "waiting" /\ phase' = "ready" /\ expired' = TRUE
          /\ UNCHANGED <<shell, submitted, wrapped, stopped>>
Abort == /\ phase \in {"idle", "waiting", "ready"}
         /\ phase' = "aborted" /\ stopped' = TRUE
         /\ UNCHANGED <<shell, submitted, wrapped, expired>>
Close == /\ phase \in {"idle", "waiting", "ready"}
         /\ phase' = "closed" /\ stopped' = TRUE
         /\ UNCHANGED <<shell, submitted, wrapped, expired>>
Submit == /\ phase = "ready" /\ phase' = "submitted" /\ submitted' = TRUE
          /\ wrapped' = (shell = "bash")
          /\ UNCHANGED <<shell, expired, stopped>>
Next == Start \/ Identify \/ Expire \/ Abort \/ Close \/ Submit
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Expire)
        /\ WF_vars(Submit)
TypeOK == /\ shell \in {"unknown", "bash", "other"}
          /\ phase \in {"idle", "waiting", "ready", "aborted", "closed",
                        "submitted"}
          /\ submitted \in BOOLEAN /\ wrapped \in BOOLEAN
          /\ expired \in BOOLEAN /\ stopped \in BOOLEAN
WaitBeforeUnknown == submitted => (shell # "unknown" \/ expired)
WrapOnlyBash == wrapped <=> (submitted /\ shell = "bash")
NoSubmitAfterStop == stopped => ~submitted
EventuallySettled == phase = "idle" ~>
                     phase \in {"submitted", "aborted", "closed"}
================================================================================
