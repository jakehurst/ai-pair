---- MODULE Draft --------------------------------------------------------------
(******************************************************************************)
(* The reply box's draft and the "reply" pause reason, across the panel's     *)
(* webview going away and coming back: packages/vscode/src/webview/panel.ts   *)
(* (syncDraft, takeDraft) and panel.ts (`draft`, `reply`, `ready`,            *)
(* onDidDispose), with Controller.pause and resume. A pause the programmer    *)
(* didn't ask for doesn't hold playback (#19). Typing a draft asks for the    *)
(* "reply" pause; a draft that is gone no longer does. The other pause        *)
(* reasons are in Timeline.tla.                                               *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    MaxPages,       \* how many pages the webview may have, counting reloads
    ClearOnReady,   \* TRUE: `ready` and onDidDispose remove the "reply" pause,
                    \* since the new page's draft is empty
    ClearOnTaken    \* TRUE: a reply the calibration takes removes the "reply"
                    \* pause too (#191)

ASSUME AssumeMaxPages == MaxPages \in Nat \ {0}
ASSUME AssumeClearOnReady == ClearOnReady \in BOOLEAN
ASSUME AssumeClearOnTaken == ClearOnTaken \in BOOLEAN

VARIABLES
    page,    \* the webview: "loaded", "disposed"
    hasDraft,   \* the page's draft is nonempty
    reportedDraft,    \* draftEmpty in the page: what it last told the extension
    replyPause,   \* "reply" is a pause reason
    pages    \* views created so far

vars == <<page, hasDraft, reportedDraft, replyPause, pages>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ page \in PageStates
    /\ hasDraft \in BOOLEAN
    /\ reportedDraft \in BOOLEAN
    /\ replyPause \in BOOLEAN
    /\ pages \in Nat \ {0}

--------------------------------------------------------------------------------

Init ==
    /\ page = "loaded"
    /\ hasDraft = FALSE
    /\ reportedDraft = FALSE
    /\ replyPause = FALSE
    /\ pages = 1

\* syncDraft: typing makes the draft nonempty, and the page posts `hasDraft`
\* when
\* emptiness changes.
TypeDraft ==
    /\ page = "loaded"
    /\ ~hasDraft
    /\ hasDraft' = TRUE
    /\ reportedDraft' = TRUE
    /\ replyPause' = TRUE
    /\ UNCHANGED <<page, pages>>

\* Deleting it, or sending it to the agent (takeDraft), or handing the turn
\* back with it.
Clear ==
    /\ page = "loaded"
    /\ hasDraft
    /\ hasDraft' = FALSE
    /\ reportedDraft' = FALSE
    /\ replyPause' = FALSE
    /\ UNCHANGED <<page, pages>>

\* Sending it while a reading speed calibration runs (#109): the calibration
\* takes it (takeDraft), and the page posts no `hasDraft`, since the box was
\* emptied before syncDraft ran.
SendToCalibration ==
    /\ page = "loaded"
    /\ hasDraft
    /\ hasDraft' = FALSE
    /\ reportedDraft' = FALSE
    /\ replyPause' = IF ClearOnTaken THEN FALSE ELSE replyPause
    /\ UNCHANGED <<page, pages>>

\* The Resume button, or sending a reply: resume() with no reason removes all
\* of them.
ResumeAll ==
    /\ page = "loaded"
    /\ replyPause
    /\ replyPause' = FALSE
    /\ UNCHANGED <<page, hasDraft, reportedDraft, pages>>

\* The view is disposed (closed, moved), with whatever draft it had.
Dispose ==
    /\ page = "loaded"
    /\ page' = "disposed"
    /\ hasDraft' = FALSE
    /\ reportedDraft' = FALSE
    /\ replyPause' = IF ClearOnReady THEN FALSE ELSE replyPause
    /\ UNCHANGED pages

\* A new page: a view resolved again, or the same view reloaded. Its draft is
\* empty, and it sends `ready`.
LoadPage ==
    /\ page' = "loaded"
    /\ hasDraft' = FALSE
    /\ reportedDraft' = FALSE
    /\ replyPause' = IF ClearOnReady THEN FALSE ELSE replyPause
    /\ pages' = pages + 1

Next ==
    \/ TypeDraft
    \/ Clear
    \/ SendToCalibration
    \/ ResumeAll
    \/ Dispose
    \/ LoadPage

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* The "reply" pause holds only while a live page has a draft.
ReplyMeansDraft == replyPause => (page = "loaded" /\ hasDraft)

\* A draft pauses playback: a step that gives the page a draft raises the
\* "reply" pause. A panel that ignored drafts would fail it.
DraftPausesProp == [][(~hasDraft /\ hasDraft') => replyPause']_vars

\* Pages run out only so that the model is finite (6.8); the panel has no limit.
Constraint == pages <= MaxPages

================================================================================
