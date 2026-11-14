---- MODULE PairShortcuts ------------------------------------------------------
EXTENDS Naturals
CONSTANTS GuardActive, PreserveGrant, PreserveDraft, DeliverFocus
VARIABLES active, attention, paused, ready, pending, focused, draft, leaked,
          lostGrant, sent
vars == <<active, attention, paused, ready, pending, focused, draft, leaked,
          lostGrant, sent>>
Init == /\ active = FALSE /\ attention = "none" /\ paused = FALSE
        /\ ready = FALSE /\ pending = FALSE /\ focused = FALSE
        /\ draft = TRUE /\ leaked = FALSE /\ lostGrant = FALSE /\ sent = FALSE
Start == /\ ~active /\ active' = TRUE
         /\ UNCHANGED <<attention, paused, ready, pending, focused, draft,
                        leaked, lostGrant, sent>>
End == /\ active /\ active' = FALSE /\ attention' = "none" /\ paused' = FALSE
       /\ pending' = FALSE /\ focused' = FALSE
       /\ UNCHANGED <<ready, draft, leaked, lostGrant, sent>>
Pause == /\ (active \/ ~GuardActive)
         /\ paused' = ~paused /\ leaked' = (leaked \/ ~active)
         /\ UNCHANGED <<active, attention, ready, pending, focused, draft,
                        lostGrant, sent>>
Hand == /\ (active \/ ~GuardActive)
        /\ attention' = CASE attention = "none" -> "requested"
                          [] attention = "requested" -> "none"
                          [] OTHER -> IF PreserveGrant
                                      THEN "granted" ELSE "none"
        /\ pending' = (pending \/ (attention = "granted"))
        /\ leaked' = (leaked \/ ~active)
        /\ lostGrant' = (lostGrant \/ (attention = "granted" /\ ~PreserveGrant))
        /\ UNCHANGED <<active, paused, ready, focused, draft, sent>>
Grant == /\ active /\ attention = "requested" /\ attention' = "granted"
         /\ UNCHANGED <<active, paused, ready, pending, focused, draft,
                        leaked, lostGrant, sent>>
Reply == /\ (active \/ ~GuardActive)
         /\ pending' = TRUE /\ leaked' = (leaked \/ ~active)
         /\ UNCHANGED <<active, attention, paused, ready, focused, draft,
                        lostGrant, sent>>
Customize == /\ sent' = (sent \/ ~PreserveDraft)
             /\ draft' = IF PreserveDraft THEN draft ELSE FALSE
             /\ UNCHANGED <<active, attention, paused, ready, pending,
                            focused, leaked, lostGrant>>
Ready == /\ ~ready /\ ready' = TRUE
         /\ UNCHANGED <<active, attention, paused, pending, focused, draft,
                        leaked, lostGrant, sent>>
Reload == /\ ready /\ ready' = FALSE /\ focused' = FALSE
          /\ UNCHANGED <<active, attention, paused, pending, draft, leaked,
                         lostGrant, sent>>
Deliver == /\ active /\ ready /\ pending /\ DeliverFocus
           /\ pending' = FALSE /\ focused' = TRUE
           /\ UNCHANGED <<active, attention, paused, ready, draft, leaked,
                          lostGrant, sent>>
Next == Start \/ End \/ Pause \/ Hand \/ Grant \/ Reply \/ Customize \/ Ready
        \/ Reload \/ Deliver
Spec == Init /\ [][Next]_vars /\ WF_vars(Ready) /\ SF_vars(Deliver)
TypeOK == /\ active \in BOOLEAN
          /\ attention \in {"none", "requested", "granted"}
          /\ paused \in BOOLEAN /\ ready \in BOOLEAN /\ pending \in BOOLEAN
          /\ focused \in BOOLEAN /\ draft \in BOOLEAN /\ leaked \in BOOLEAN
          /\ lostGrant \in BOOLEAN /\ sent \in BOOLEAN
NoInactiveEffect == ~leaked
GrantedIsPreserved == ~lostGrant
DraftNotSubmitted == draft /\ ~sent
FocusProgress == active /\ pending ~> ~active \/ ~pending
================================================================================
