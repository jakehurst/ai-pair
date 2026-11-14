---- MODULE CiScheduler --------------------------------------------------------
EXTENDS Naturals, FiniteSets

\* Two workers process three independent configs. Results are reported once,
\* after every config finishes; completion order is unconstrained.
CONSTANTS Configs, Limit
VARIABLES pending, active, done, failed, reported, reportFailed, canceled
vars == <<pending, active, done, failed, reported, reportFailed, canceled>>
Init == /\ pending = Configs /\ active = {} /\ done = {}
        /\ failed = {} /\ reported = FALSE /\ reportFailed = FALSE
        /\ canceled = FALSE
Start(c) == /\ ~canceled /\ c \in pending /\ Cardinality(active) < Limit
            /\ pending' = pending \ {c} /\ active' = active \cup {c}
            /\ UNCHANGED <<done, failed, reported, reportFailed, canceled>>
Finish(c, bad) == /\ c \in active /\ active' = active \ {c}
                  /\ done' = done \cup {c}
                  /\ failed' = IF bad THEN failed \cup {c} ELSE failed
                  /\ UNCHANGED <<pending, reported, reportFailed, canceled>>
Report == /\ ~canceled /\ done = Configs /\ ~reported /\ reported' = TRUE
          /\ reportFailed' = (failed # {})
          /\ UNCHANGED <<pending, active, done, failed, canceled>>
Cancel == /\ ~canceled /\ ~reported /\ canceled' = TRUE
          /\ UNCHANGED <<pending, active, done, failed, reported, reportFailed>>
Next == \/ Cancel
        \/ \E c \in Configs: Start(c)
        \/ \E c \in Configs, bad \in BOOLEAN: Finish(c, bad)
        \/ Report
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
TypeOK == /\ pending \subseteq Configs /\ active \subseteq Configs
          /\ done \subseteq Configs /\ failed \subseteq done
          /\ reported \in BOOLEAN /\ reportFailed \in BOOLEAN
          /\ canceled \in BOOLEAN
Partition == /\ pending \cup active \cup done = Configs
             /\ pending \cap active = {} /\ pending \cap done = {}
             /\ active \cap done = {}
Bounded == Cardinality(active) <= Limit
NoEarlyReport == reported => done = Configs
NoReportAfterCancel == reported => ~canceled
FailurePreserved == reported => (reportFailed = (failed # {}))
EventuallySettled == TRUE ~> (reported \/ (canceled /\ active = {}))
================================================================================
