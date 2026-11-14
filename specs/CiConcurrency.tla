---- MODULE CiConcurrency ------------------------------------------------------
EXTENDS Naturals, FiniteSets

\* Each run has a unique identity. Manual runs use that identity as their key;
\* push and pull-request keys include their event and branch or PR number.
CONSTANTS Runs, Manual, p1, p2, push
Key == [r \in Runs |-> IF r \in Manual THEN r
                     ELSE IF r = push THEN push ELSE p1]
VARIABLES pending, active, canceled
vars == <<pending, active, canceled>>
Init == /\ pending = Runs /\ active = {} /\ canceled = {}
Start(r) == /\ r \in pending
            /\ pending' = pending \ {r}
            /\ canceled' = canceled \cup {x \in active: Key[x] = Key[r]}
            /\ active' = (active \ {x \in active: Key[x] = Key[r]}) \cup {r}
Finish(r) == /\ r \in active /\ active' = active \ {r}
             /\ UNCHANGED <<pending, canceled>>
Next == \/ \E r \in Runs: Start(r)
        \/ \E r \in Runs: Finish(r)
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
TypeOK == /\ pending \subseteq Runs /\ active \subseteq Runs
          /\ canceled \subseteq Runs
Partition == /\ pending \cap active = {} /\ pending \cap canceled = {}
             /\ active \cap canceled = {}
OnePerGroup == \A a, b \in active: Key[a] = Key[b] => a = b
ManualSafe == canceled \cap Manual = {}
AllStarted == TRUE ~> pending = {}
================================================================================
