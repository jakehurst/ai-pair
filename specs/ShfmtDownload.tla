---- MODULE ShfmtDownload ------------------------------------------------------
EXTENDS Naturals

\* Each source returns one of three bounded results: unavailable, wrong bytes,
\* or the pinned bytes. Curl's own bounded retries are abstracted into a result.
VARIABLES phase, primary, fallback, output, verified, result
vars == <<phase, primary, fallback, output, verified, result>>
Init == /\ phase = "primary" /\ primary = "pending" /\ fallback = "pending"
        /\ output = "none" /\ verified = FALSE /\ result = "pending"
Primary(outcome) == /\ phase = "primary" /\ primary' = outcome
  /\ (IF outcome = "valid"
        THEN /\ phase' = "done" /\ output' = "valid"
             /\ verified' = TRUE /\ result' = "success"
        ELSE /\ phase' = "fallback" /\ output' = "none"
             /\ UNCHANGED <<verified, result>>)
  /\ UNCHANGED fallback
Fallback(outcome) == /\ phase = "fallback" /\ fallback' = outcome
  /\ phase' = "done"
  /\ (IF outcome = "valid"
        THEN /\ output' = "valid" /\ verified' = TRUE /\ result' = "success"
        ELSE /\ output' = "none" /\ verified' = FALSE /\ result' = "failure")
  /\ UNCHANGED primary
Next == \E outcome \in {"fail", "bad", "valid"}:
          Primary(outcome) \/ Fallback(outcome)
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
TypeOK == /\ phase \in {"primary", "fallback", "done"}
          /\ primary \in {"pending", "fail", "bad", "valid"}
          /\ fallback \in {"pending", "fail", "bad", "valid"}
          /\ output \in {"none", "valid"} /\ verified \in BOOLEAN
          /\ result \in {"pending", "success", "failure"}
VerifiedSuccess == result = "success" => verified /\ output = "valid"
FallbackWorks == (phase = "done" /\ primary \in {"fail", "bad"}
                  /\ fallback = "valid") => result = "success"
FailureClean == result = "failure" => output = "none" /\ ~verified
Finished == phase = "done" => result # "pending"
EventuallySettled == TRUE ~> phase = "done"
================================================================================
