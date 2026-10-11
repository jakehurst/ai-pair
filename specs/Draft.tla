---- MODULE Draft --------------------------------------------------------------
(******************************************************************************)
(* The reply box's draft and the "reply" pause reason, across the panel's     *)
(* webview going away and coming back: packages/vscode/src/webview/panel.ts   *)
(* (syncDraft, takeDraft) and panel.ts (`draft`, `reply`, `ready`,            *)
(* onDidDispose), with Controller.pause and resume. L4 in #19: a pause the    *)
(* programmer didn't ask for doesn't hold playback. Typing a draft asks for   *)
(* the "reply" pause; a draft that is gone no longer does. The other pause    *)
(* reasons are in Timeline.tla.                                               *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxViews,       \* how many pages the webview may have, counting reloads
    ClearOnReady    \* TRUE: `ready` and onDidDispose remove the "reply" pause,
                    \* since the new page's draft is empty

ASSUME AssumeMaxViews == MaxViews \in Nat \ {0}
ASSUME AssumeClearOnReady == ClearOnReady \in BOOLEAN

VARIABLES
    view,    \* the webview: "live", "gone"
    draft,   \* the page's draft is nonempty
    sent,    \* draftEmpty in the page: what it last told the extension
    reply,   \* "reply" is a pause reason
    views    \* views created so far

vars == <<view, draft, sent, reply, views>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ view \in {"live", "gone"}
    /\ draft \in BOOLEAN
    /\ sent \in BOOLEAN
    /\ reply \in BOOLEAN
    /\ views \in Nat \ {0}

--------------------------------------------------------------------------------

Init ==
    /\ view = "live"
    /\ draft = FALSE
    /\ sent = FALSE
    /\ reply = FALSE
    /\ views = 1

\* syncDraft: typing makes the draft nonempty, and the page posts `draft` when
\* emptiness changes.
Type ==
    /\ view = "live"
    /\ ~draft
    /\ draft' = TRUE
    /\ sent' = TRUE
    /\ reply' = TRUE
    /\ UNCHANGED <<view, views>>

\* Deleting it, or sending it (takeDraft), or handing the turn back with it.
Clear ==
    /\ view = "live"
    /\ draft
    /\ draft' = FALSE
    /\ sent' = FALSE
    /\ reply' = FALSE
    /\ UNCHANGED <<view, views>>

\* The Resume button, or sending a reply: resume() with no reason removes all
\* of them.
ResumeAll ==
    /\ view = "live"
    /\ reply
    /\ reply' = FALSE
    /\ UNCHANGED <<view, draft, sent, views>>

\* The view is disposed (closed, moved), with whatever draft it had.
Dispose ==
    /\ view = "live"
    /\ view' = "gone"
    /\ draft' = FALSE
    /\ sent' = FALSE
    /\ reply' = IF ClearOnReady THEN FALSE ELSE reply
    /\ UNCHANGED views

\* A new page: a view resolved again, or the same view reloaded. Its draft is
\* empty, and it sends `ready`.
Ready ==
    /\ view' = "live"
    /\ draft' = FALSE
    /\ sent' = FALSE
    /\ reply' = IF ClearOnReady THEN FALSE ELSE reply
    /\ views' = views + 1

Next ==
    \/ Type
    \/ Clear
    \/ ResumeAll
    \/ Dispose
    \/ Ready

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* The "reply" pause holds only while a live page has a draft.
ReplyMeansDraft == reply => (view = "live" /\ draft)

\* A draft pauses playback: a step that gives the page a draft raises the
\* "reply" pause. A panel that ignored drafts would fail it.
DraftPausesProp == [][(~draft /\ draft') => reply']_vars

\* Pages run out only so that the model is finite (6.8); the panel has no limit.
Constraint == views <= MaxViews

================================================================================
