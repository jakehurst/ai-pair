---- MODULE CommandEncoding ----------------------------------------------------
EXTENDS Naturals

CONSTANTS ExactEncode, ScopeBash
Chars == {"letter", "quote", "slash", "newline", "control", "unicode"}
VARIABLES shell, original, submitted, approved, changed, wrapped
vars == <<shell, original, submitted, approved, changed, wrapped>>
Init == /\ shell \in {"bash", "other"} /\ original \in Chars
        /\ submitted = "none" /\ approved = original /\ changed = FALSE
        /\ wrapped = FALSE
Submit == /\ submitted = "none"
          /\ submitted' = IF shell = "bash" \/ ~ScopeBash
                          THEN IF ExactEncode THEN original ELSE "corrupt"
                          ELSE original
          /\ wrapped' = (shell = "bash" \/ ~ScopeBash)
          /\ changed' = (changed \/ (approved # original))
          /\ UNCHANGED <<shell, original, approved>>
Next == Submit
Spec == Init /\ [][Next]_vars /\ WF_vars(Submit)
TypeOK == /\ shell \in {"bash", "other"} /\ original \in Chars
          /\ submitted \in Chars \cup {"none"} /\ approved \in Chars
          /\ changed \in BOOLEAN /\ wrapped \in BOOLEAN
PayloadPreserved == submitted = "none" \/ submitted = original
ApprovalPreserved == ~changed
ScopeBashOnly == shell = "other" => ~wrapped
EventuallySubmitted == submitted = "none" ~> submitted # "none"
================================================================================
