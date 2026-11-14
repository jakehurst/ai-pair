---- MODULE IntegrationFixture -------------------------------------------------
EXTENDS Naturals

CONSTANTS PlaceInside, CleanupOwned
VARIABLES phase, development, fixture, launched, leaked
vars == <<phase, development, fixture, launched, leaked>>
Roots == {"workspace", "packaged", "companion"}
Init == /\ phase = "initial" /\ development \in Roots
        /\ fixture = "none" /\ launched = FALSE /\ leaked = FALSE
Build == /\ phase = "initial" /\ phase' = "built"
         /\ fixture' = IF PlaceInside THEN development ELSE "outside"
         /\ UNCHANGED <<development, launched, leaked>>
Launch == /\ phase = "built" /\ phase' = "launched" /\ launched' = TRUE
          /\ UNCHANGED <<development, fixture, leaked>>
Cleanup == /\ phase \in {"built", "launched"} /\ phase' = "finished"
           /\ leaked' = ~CleanupOwned
           /\ fixture' = IF CleanupOwned THEN "none" ELSE fixture
           /\ UNCHANGED <<development, launched>>
Next == Build \/ Launch \/ Cleanup
Spec == Init /\ [][Next]_vars /\ WF_vars(Build) /\ WF_vars(Cleanup)
TypeOK == /\ phase \in {"initial", "built", "launched", "finished"}
          /\ development \in Roots /\ fixture \in Roots \cup {"none", "outside"}
          /\ launched \in BOOLEAN /\ leaked \in BOOLEAN
SameExtension == phase = "launched" => fixture = development
NoLeftovers == phase = "finished" => ~leaked
EventuallyCleaned == phase = "initial" ~> phase = "finished"
================================================================================
