# Google-Style TLA+ Specification Style Guide

> **Status.** This is an unofficial style guide. It follows the structure and
> conventions of the published Google style guides (Java, C++, Python, Shell)
> but is not endorsed by Google, the TLA+ Foundation, or Leslie Lamport. Its
> conventions are derived from the idioms taught at
> [TLA+ By Example](https://learning.tlapl.us/), from Lamport's
> [*Specifying Systems*](https://lamport.azurewebsites.net/tla/book-02-08-08.pdf)
> (cited below as *SS* with chapter/section numbers), from the standalone
> [*Summary of TLA+*](https://lamport.azurewebsites.net/tla/summary-standalone.pdf)
> reference card (cited as *Summary*; it reproduces *SS* pp. 268-273), from
> the standard modules shipped with the TLA+ tools, and from the community
> specifications in [tlaplus/Examples](https://github.com/tlaplus/Examples).
> Where the two primary sources differ (e.g. `TypeOK` vs. `TypeInvariant`),
> this guide picks one and says so.

## Table of Contents

1.  [Introduction](#1-introduction)
    1. [Terminology notes](#11-terminology-notes)
    2. [Guide notes](#12-guide-notes)
2.  [Source file basics](#2-source-file-basics)
    1. [File name](#21-file-name)
    2. [File encoding](#22-file-encoding)
    3. [ASCII vs. Unicode operators](#23-ascii-vs-unicode-operators)
    4. [Companion files](#24-companion-files)
3.  [Source file structure](#3-source-file-structure)
    1. [Preamble](#31-preamble)
    2. [Module header](#32-module-header)
    3. [EXTENDS](#33-extends)
    4. [Constant declarations](#34-constant-declarations)
    5. [Assumptions](#35-assumptions)
    6. [Variable declarations](#36-variable-declarations)
    7. [Definitions](#37-definitions)
    8. [Specification and properties](#38-specification-and-properties)
    9. [Refinement and theorems](#39-refinement-and-theorems)
    10. [Module footer](#310-module-footer)
4.  [Formatting](#4-formatting)
    1.  [Indentation](#41-indentation)
    2.  [Column limit](#42-column-limit)
    3.  [Bulleted conjunctions and
        disjunctions](#43-bulleted-conjunctions-and-disjunctions)
    4.  [Definitions](#44-definitions)
    5.  [Horizontal whitespace](#45-horizontal-whitespace)
    6.  [Vertical whitespace and
        separators](#46-vertical-whitespace-and-separators)
    7.  [Line wrapping](#47-line-wrapping)
    8.  [LET/IN, IF/THEN/ELSE, CASE](#48-letin-ifthenelse-case)
    9.  [Quantifiers and set builders](#49-quantifiers-and-set-builders)
    10.  [EXCEPT](#410-except)
5.  [Naming](#5-naming)
    1. [Rules common to all identifiers](#51-rules-common-to-all-identifiers)
    2. [Module names](#52-module-names)
    3. [Constant names](#53-constant-names)
    4. [Variable names](#54-variable-names)
    5. [Operator names](#55-operator-names)
    6. [Action names](#56-action-names)
    7. [Invariant and property names](#57-invariant-and-property-names)
    8. [Bound variable names](#58-bound-variable-names)
    9. [Record field names](#59-record-field-names)
    10. [String values](#510-string-values)
    11. [Model values](#511-model-values)
    12. [Reserved and conventional names](#512-reserved-and-conventional-names)
    13. [User-definable operator symbols](#513-user-definable-operator-symbols)
6.  [Specification practices](#6-specification-practices)
    1.  [Always define TypeOK](#61-always-define-typeok)
    2.  [Init/Next/Spec pattern](#62-initnextspec-pattern)
    3.  [One action, one concept](#63-one-action-one-concept)
    4.  [Guards before effects](#64-guards-before-effects)
    5.  [Every action is total over the
        variables](#65-every-action-is-total-over-the-variables)
    6.  [Prefer UNCHANGED](#66-prefer-unchanged)
    7.  [Prefer `\in` over `=` for nondeterministic initial
        states](#67-prefer-in-over--for-nondeterministic-initial-states)
    8.  [Keep models finite in the configuration, not the
        spec](#68-keep-models-finite-in-the-configuration-not-the-spec)
    9.  [CHOOSE discipline](#69-choose-discipline)
    10.  [Fairness](#610-fairness)
    11.  [Safety before liveness](#611-safety-before-liveness)
    12.  [Symmetry](#612-symmetry)
    13.  [Deadlock](#613-deadlock)
    14.  [Avoid TLC-only operators in the
         model](#614-avoid-tlc-only-operators-in-the-model)
    15.  [Prefer records over tuples for structured
         data](#615-prefer-records-over-tuples-for-structured-data)
    16.  [Recursion](#616-recursion)
    17.  [INSTANCE and LOCAL](#617-instance-and-local)
    18.  [PlusCal](#618-pluscal)
    19.  [Functions vs. operators](#619-functions-vs-operators)
    20.  [Prefer definitions to
         parameters](#620-prefer-definitions-to-parameters)
    21.  [Hiding internal variables](#621-hiding-internal-variables)
    22.  [Closed-system specifications](#622-closed-system-specifications)
    23.  [Choosing the grain of atomicity](#623-choosing-the-grain-of-atomicity)
    24.  [Start from sample behaviors](#624-start-from-sample-behaviors)
    25.  [Don't be too clever](#625-dont-be-too-clever)
    26.  [Don't assume different-looking values are
         unequal](#626-dont-assume-different-looking-values-are-unequal)
    27.  [Move quantification to the
         outside](#627-move-quantification-to-the-outside)
    28.  [Prime only variables](#628-prime-only-variables)
    29.  [Keep temporal formulas in canonical
         form](#629-keep-temporal-formulas-in-canonical-form)
    30.  [A type invariant is not an
         assumption](#630-a-type-invariant-is-not-an-assumption)
    31.  [Don't be too abstract](#631-dont-be-too-abstract)
    32.  [Write comments as comments](#632-write-comments-as-comments)
    33.  [Specify during design, not
         after](#633-specify-during-design-not-after)
7.  [Comments](#7-comments)
    1. [Comment syntax](#71-comment-syntax)
    2. [Where comments are required](#72-where-comments-are-required)
    3. [Where comments are discouraged](#73-where-comments-are-discouraged)
    4. [TODO comments](#74-todo-comments)
8.  [TLC configuration files](#8-tlc-configuration-files)
    1.  [Structure](#81-structure)
    2.  [One model, one file](#82-one-model-one-file)
    3.  [Prefer SPECIFICATION over
        INIT/NEXT](#83-prefer-specification-over-initnext)
    4.  [Constants](#84-constants)
    5.  [Invariants and properties](#85-invariants-and-properties)
    6.  [State-space controls](#86-state-space-controls)
    7.  [Model-checking workflow](#87-model-checking-workflow)
9.  [Appendix: a complete example](#9-appendix-a-complete-example)

---

## 1 Introduction

This document serves as the **complete** definition of coding standards for TLA+
specifications. A TLA+ source file is described as being *in Google Style* if
and only if it adheres to the rules herein.

Like other Google style guides, this document covers aesthetic formatting
issues, but also other types of conventions and coding standards. However, it
focuses primarily on the **hard-and-fast rules** that we follow universally, and
avoids giving *advice* that isn't clearly enforceable (whether by human or
tool).

### 1.1 Terminology notes

In this document, unless otherwise clarified:

1.  The term *spec* refers to a TLA+ module and its companion TLC configuration
    file(s).
2.  The term *definition* refers to anything introduced with `==`, including
    operators, state predicates, actions, and temporal formulas.
3.  A *state function* is an expression with no prime or temporal operator that
    may contain variables and constants; a *state predicate* is a Boolean-valued
    state function. An *action* is a formula mentioning primed variables. A
    *temporal formula* contains `[]`, `<>`, `~>`, `WF_`, or `SF_`. (*SS* section
    3.1)
4.  An *invariant* of `Spec` is a state predicate `Inv` such that
    `Spec => []Inv` is a theorem. A variable `v` *has type* `T` in `Spec` iff
    `v \in T` is an invariant of `Spec`. Type correctness is just a name for a
    particular invariance property; naming a formula `TypeOK` gives it no
    special status. (*SS* section 3.1, section 3.3)
5.  The term *bulleted list* refers to the TLA+ layout in which each conjunct or
    disjunct begins with `/\` or `\/` on its own line.

Other "terminology notes" appear occasionally throughout the document.

### 1.2 Guide notes

Example code in this document is **non-normative**. That is, while the examples
are in Google Style, they may not illustrate the *only* stylish way to represent
the code. Optional formatting choices made in examples should not be enforced as
rules.

---

## 2 Source file basics

### 2.1 File name

The file name consists of the module name, which is case-sensitive, plus the
`.tla` extension. The module name **must** match the file name exactly; TLC and
SANY reject a mismatch.

TLC configuration files use the `.cfg` extension. The primary configuration for
module `Foo` is `Foo.cfg`. Additional configurations are `Foo_<Model>.cfg` (see
[section 8.2](#82-one-model-one-file)).

### 2.2 File encoding

Source files are encoded in **UTF-8**. Line endings are LF. The file ends with a
single trailing newline after the module footer and any post-footer text.

### 2.3 ASCII vs. Unicode operators

TLA+ accepts both ASCII (`/\`, `\in`, `[]`) and Unicode (U+2227 for `/\`, U+2208
for `\in`, U+25A1 for `[]`) spellings of its operators. Within one repository,
**pick one and use it consistently**. The default is **ASCII**, because:

-   Every tool (SANY, TLC, TLAPS, Apalache, `tla2tex`) accepts it.
-   It survives copy/paste through terminals, mail, and diff tools unchanged.
-   Column alignment (see [section
    4.3](#43-bulleted-conjunctions-and-disjunctions)) is easier to maintain in
    monospaced editors.

A repository may opt into Unicode when all contributors use an editor that
renders and inputs it reliably. Never mix spellings within a module. The TLA+ VS
Code extension and `tlauc` can translate between the two.

### 2.4 Companion files

A spec directory contains, at minimum, `Foo.tla` and `Foo.cfg`. It may also
contain `Foo_<Model>.cfg` files, `MCFoo.tla` (a model-checking wrapper, see
[section 6.14](#614-avoid-tlc-only-operators-in-the-model)), and `README.md`.
Generated files (`Foo.toolbox/`, `states/`, `*.old`, PlusCal `.tla.bak`) are
never committed.

---

## 3 Source file structure

A source file consists of, **in order**:

1. Preamble text (optional).
2. Module header.
3. `EXTENDS` (optional).
4. `CONSTANTS` and their `ASSUME`s.
5. `VARIABLES` and the `vars` tuple.
6. Helper definitions, type definitions, and `TypeOK`.
7. `Init`.
8. Actions.
9. `Next`, fairness, `Spec`.
10. Invariants and temporal properties.
11. Refinement mappings and `THEOREM`s (optional).
12. Module footer.
13. Post-footer text (optional).

**Exactly one blank line** separates each top-level definition. Separator lines
(`----`) delimit the sections listed above.

### 3.1 Preamble

Text before the module header is ignored by the tools. Use it, if at all, for a
license header only. The description of *what the module models* belongs
**inside** the module, in a block comment immediately after the header, where
`tla2tex` and the VS Code hover provider can find it.

### 3.2 Module header

The header line is exactly four dashes, a space, `MODULE`, a space, the module
name, a space, and dashes padding to the column limit:

```tla
---- MODULE BoundedBuffer ------------------------------------------------------
```

A block comment describing the module's purpose, the system it models, and the
abstraction level follows the header. This comment is **required** for every
module.

```tla
---- MODULE BoundedBuffer ------------------------------------------------------
(***************************************************************************)
(* A bounded FIFO buffer shared between producer and consumer threads.     *)
(* Producers block when the buffer is full; consumers block when it is     *)
(* empty. Models the single-condition-variable implementation and is       *)
(* expected to exhibit the deadlock described in Charpentier's note.       *)
(***************************************************************************)
```

### 3.3 EXTENDS

`EXTENDS` appears on one line, immediately after the header comment. Modules are
listed in three groups: standard modules, then community modules, then project
modules. Standard modules appear in this fixed order: `Naturals` or `Integers`
or `Reals`, `Sequences`, `FiniteSets`, `Bags`, `TLC`. Within the other two
groups, alphabetical.

```tla
EXTENDS Naturals, Sequences, FiniteSets, TLC, SequencesExt, Messages
```

Extend only what is used, and only the most general numbers module needed:
`Reals` subsumes `Integers`, which subsumes `Naturals`. Never list two of them.
Note that `Naturals` defines `-` only as infix subtraction and does not define
`Int`; a spec that needs negative numbers or unary minus extends `Integers`.
`TLC` is extended only when the module uses TLC operators (see [section
6.14](#614-avoid-tlc-only-operators-in-the-model)). (*Summary*, "Operators
Defined in Standard Modules")

### 3.4 Constant declarations

Use the plural keyword `CONSTANTS`, one declaration group per line, with each
constant commented:

```tla
CONSTANTS
    Producers,      \* Set of producer process identifiers
    Consumers,      \* Set of consumer process identifiers
    BufCapacity     \* Maximum number of elements the buffer can hold
```

Constants with operator arity are declared with their parameter pattern, one per
line, each with a comment stating what a true value *means*, since the
declaration itself says nothing about the value (*SS* section 5.1):

```tla
CONSTANTS
    \* Send(p, d, miOld, miNew) is TRUE iff a step taking memInt from
    \* miOld to miNew represents processor p sending d to the memory.
    Send(_, _, _, _),
    Reply(_, _, _, _)   \* Likewise for the memory replying to p.

ASSUME AssumeInterfaceBoolean ==
    \A p, d, miOld, miNew :
        /\ Send(p, d, miOld, miNew) \in BOOLEAN
        /\ Reply(p, d, miOld, miNew) \in BOOLEAN
```

Operator-valued constants are the TLA+ substitute for "action parameters": pass
the old and new values of the relevant variable explicitly rather than priming
inside the constant.

### 3.5 Assumptions

Every constant whose value is restricted has an `ASSUME` immediately following
the declarations. Name assumptions when there is more than one.

```tla
ASSUME AssumeProcs ==
    /\ Producers # {} /\ Consumers # {}
    /\ Producers \cap Consumers = {}
ASSUME AssumeCapacity == BufCapacity \in Nat \ {0}
```

TLC checks `ASSUME`s once at startup; a mistyped constant is caught before any
state is generated.

An `ASSUME` may mention **only constants, never variables**. Asserting
`ASSUME q \in Seq(Message)` is wrong, not merely unstylish: a state is an
arbitrary assignment of values to variables, so there are states in which `q` is
not a sequence, and assuming they do not exist is a logical contradiction. Type
restrictions on variables belong in `TypeOK` and are *proved* (or model-checked)
as `THEOREM Spec => []TypeOK`. (*SS* section 4.4)

Do not assume that a constant is a set (every TLA+ value is a set), and do not
assume it is finite unless the specification requires finiteness; most
specifications make sense for infinite sets of messages or processors. (*SS*
section 4.4)

### 3.6 Variable declarations

Use the plural keyword `VARIABLES`, one variable per line, each commented with
its role and intended type. Immediately after, define the `vars` tuple listing
every variable in declaration order.

```tla
VARIABLES
    buffer,     \* Sequence of produced items, oldest first
    waitSet     \* Set of processes blocked on the condition variable

vars == <<buffer, waitSet>>
```

Declaring all variables in a single block is **required**. Interleaving
`VARIABLES` with definitions is permitted by the language but forbidden by this
guide, because it hides the state space.

### 3.7 Definitions

Helper operators come before the actions that use them. `TypeOK` is the
**first** definition after `vars`; it doubles as the documentation of the state
space's shape.

### 3.8 Specification and properties

`Next` is a disjunction of actions, written as a bulleted list, one action per
line. Fairness is named separately. `Spec` is the canonical form:

```tla
Next ==
    \/ \E p \in Producers : Put(p)
    \/ \E c \in Consumers : Get(c)

Fairness == \A p \in Producers : WF_vars(Put(p))

Spec == Init /\ [][Next]_vars /\ Fairness
```

A specification with no fairness conditions omits the `Fairness` definition and
the conjunct: `Spec == Init /\ [][Next]_vars`.

Invariants and properties follow `Spec`, each as its own definition, under a
separator line.

When the specification models both a system and its environment, structure
`Next` as `SysNext \/ EnvNext` and define each as a disjunction of actions. This
has no formal significance (`Spec` is the same formula either way) but tells the
reader which steps are the system's responsibility. (*SS* section 4.5)

### 3.9 Refinement and theorems

A refinement mapping is an `INSTANCE` with substitution, followed by a `THEOREM`
stating the refinement. Theorems record what the spec claims, even when they are
only checked by TLC rather than proved.

```tla
Abstract == INSTANCE AbstractQueue WITH q <- buffer

THEOREM Spec => Abstract!Spec
THEOREM Spec => []TypeOK
```

### 3.10 Module footer

The footer is a line of equals signs padded to the column limit:

```tla
================================================================================
```

Text after the footer is ignored. **Do not** keep a modification history there;
version control owns that. The only acceptable post-footer content is empty.

---

## 4 Formatting

**Terminology note:** TLA+ is one of the few languages where layout is
**semantically significant**. The horizontal position of `/\` and `\/` bullets
determines how a formula parses. Formatting rules in this section are therefore
correctness rules, not merely aesthetic ones.

### 4.1 Indentation

Use **4 spaces** per indentation level. Never use tabs. The language guarantees
only that a tab occupies "one or more" columns and that identical leading
space/tab sequences occupy the same width; whether a tab-indented `/\` lines up
with a space-indented one is **unspecified**, so a tab can silently change what
a formula means. (*SS* section 15.2.2: "I strongly advise you never to use
them.")

### 4.2 Column limit

The column limit is **80**. Lines that would exceed it are wrapped per [section
4.7](#47-line-wrapping).

**Exceptions:**

1.  The module header and footer lines (exactly 80 characters wide).
2.  A URL inside a comment.
3.  A `CONSTANT` or `VARIABLE` declaration whose trailing comment pushes it past
    the limit; prefer wrapping the comment, but a single overrun is tolerated.

### 4.3 Bulleted conjunctions and disjunctions

Any conjunction or disjunction of **two or more** operands that does not fit
comfortably on one line is written as a bulleted list: each operand on its own
line, prefixed with `/\` or `\/`, with all bullets in a list aligned to the
**same column**.

```tla
Put(p) ==
    /\ p \notin waitSet
    /\ Len(buffer) < BufCapacity
    /\ buffer' = Append(buffer, p)
    /\ UNCHANGED waitSet
```

Nested lists indent one level (4 spaces) relative to the enclosing bullet,
measured from the bullet character itself:

```tla
Next ==
    \/ /\ Len(buffer) < BufCapacity
       /\ \E p \in Producers : Put(p)
    \/ /\ buffer # <<>>
       /\ \E c \in Consumers : Get(c)
```

A list whose operands **all** fit on one line within the column limit may be
written inline: `/\ x \in Nat /\ y \in Nat`. Never mix inline and bulleted form
within one list. Never put the first bullet on the same line as `==` when any
subsequent bullet is on its own line.

The language rule (*SS* section 3.1, section 15.2.2) is: each item begins with
its bullet, and the item's entire text must lie **strictly to the right of that
bullet's column**, on however many lines it occupies. An item is ended by the
next bullet in the same column when that bullet is the first non-space character
on its line (which starts the next item), or by **any other** token at or to the
left of the bullet column (which ends the whole list). A multi-line item is
therefore indented past its bullet:

```tla
Deliver(m) ==
    /\ m \in msgs
    /\ received' = received \cup
           {[id |-> m.id, payload |-> m.payload]}   \* past the bullet
    /\ UNCHANGED msgs
```

Rationale: a bullet one column left of its siblings, or a continuation line that
drifts back to the bullet column, silently terminates the list and attaches the
remainder to the *outer* formula. The single-column rule makes such errors
visible in a diff. Because the layout removes the need for parentheses, bulleted
form is **preferred** over parenthesized `/\` chains whenever conjunctions or
disjunctions nest.

Parentheses cannot rescue a misaligned list. The following is a **syntax
error**, because the first list ends at the `=` and leaves `(x'` unmatched (*SS*
section 15.2.2):

```tla
/\ (x'
= y)
/\ y' = x
```

A list is also ended by a closing delimiter whose opening partner precedes the
list, so a bulleted list inside `( )`, `[ ]`, `{ }` or `<< >>` ends at the
closing bracket regardless of column.

### 4.4 Definitions

A definition's name, parameters, and `==` appear on the first line. If the body
fits on the remainder of the line within the column limit, it goes there.
Otherwise the body begins on the next line, indented one level.

```tla
Max(a, b) == IF a > b THEN a ELSE b

Range(f) == {f[x] : x \in DOMAIN f}

PendingFor(p) ==
    {m \in msgs : m.dst = p /\ m.id \notin {r.id : r \in received[p]}}
```

Place exactly one space on each side of `==`. Do not align `==` across
consecutive definitions.

### 4.5 Horizontal whitespace

-   One space on each side of binary operators: `x + 1`, `a \in S`, `f[i] = v`,
    `P => Q`.
-   No space inside brackets: `f[i]`, `<<a, b>>`, `[x |-> 1]`, `{1, 2}`.
-   One space after a comma, none before.
-   One space on each side of `:` in quantifiers, set builders, and function
    constructors: `\E x \in S : P(x)`, `{x \in S : P(x)}`, `[x \in S |-> e]`.
-   No space between an operator name and its argument list: `Put(p)`.
-   One space after `\*` and inside `(* *)`.
-   Never align operands or comments with internal runs of spaces beyond what
    bullet alignment requires. (Trailing comments on declaration lines, as in
    [section 3.4](#34-constant-declarations), are the sole exception.)
-   **Parenthesize when in doubt.** TLA+ has an elaborate precedence table (*SS*
    Table 6) and some operators, such as `=>` and `<=>`, have precedences that
    surprise programmers. Redundant parentheses never hurt; if there is the
    slightest doubt about whether they are needed, use them. (*SS* section 1.1,
    section 15.2.1)
-   **Parenthesize overlapping precedences.** An expression is *illegal*, not
    merely ambiguous, when two adjacent operators have overlapping precedence
    ranges and are not two instances of one left-associative operator. The cases
    that bite in practice (*Summary*, "Precedence Ranges of Operators"; *SS*
    section 15.2.1):
    -   `*` (13-13, associative) and `/` (13-13, not): `a / b * c` and
        `a * b / c` are illegal.
    -   `+` (10-10) and `%` (10-11): `a + b % c` is illegal.
    -   The comparison and membership operators `=`, `#`, `<`, `<=`, `\in`,
        `\subseteq`, ... are all 5-5 and **not** associative: `a = b = c` and
        `x \in S \subseteq T` are illegal.
    -   `\` (set difference, 8-8, not associative) with itself or with
        `\cup`/`\cap` (8-8, associative): `A \ B \ C` and `A \cup B \ C` are
        illegal.
    -   `..` (9-9) with `+` (10-10) is fine (`1..n+1` means `1..(n+1)`), but the
        result surprises enough readers that `1..(n+1)` is required. Precedence
        runs, highest first: `.` (17) > function application (16) > `'` (15) >
        `^` (14) > `*`, `/` (13) > unary `-` (12) > `+`, `-` (10) > `..` (9) >
        set operators (8) > `:>`, `@@` (6-7) > comparisons (5) > `[]`, `<>`,
        `ENABLED`, `UNCHANGED` (4-15) > `/\`, `\/` (3) > `<=>`, `~>` (2) > `=>`
        (1). Because `=>` binds loosest, `P /\ Q => R` is `(P /\ Q) => R`, and
        the right-hand side of `=>` must be parenthesized when it is itself an
        implication.
-   **Parenthesize undelimited constructs.** `IF`/`THEN`/`ELSE`, `CASE`,
    `LET`/`IN`, `CHOOSE`, and quantifiers have no closing keyword and extend as
    far to the right as possible: `IF x > 0 THEN y + 1 ELSE y - 1 + 2` parses as
    `ELSE (y - 1 + 2)`, and `\A x \in S : P(x) \/ Q` parses as
    `\A x \in S : (P(x) \/ Q)`. Any such construct that is followed by an infix
    operator or another operand is wrapped in parentheses. (*SS* section 15.2.1)
-   **Parenthesize non-identifier subscripts.** Write `[A]_(f[x])` and
    `WF_(<<x, y>>)(A)`, never `[A]_f[x]`; a subscript is written bare only when
    it is a single identifier such as `vars`. (*SS* section 15.2.1)
-   Write `<=>` (or `\equiv`), not `=`, for equality of Boolean values, so the
    reader can see at a glance that both sides are Booleans. (*SS* section 1.1,
    section 16.1.3)
-   Prefer bounded quantification (`\A x \in S :`) to unbounded (`\A x :`); it
    is easier for both people and tools. (*SS* section 1.3)

### 4.6 Vertical whitespace and separators

-   One blank line between top-level definitions.
-   No blank lines inside a definition body except to separate `LET` bindings
    from each other when they are long.
-   A separator line of four dashes padded to column 80 precedes each major
    section ([section 3](#3-source-file-structure)). A separator is followed by
    one blank line.

```tla
--------------------------------------------------------------------------------
```

### 4.7 Line wrapping

When a formula does not fit:

1.  Convert the outermost conjunction or disjunction to a bulleted list
    ([section 4.3](#43-bulleted-conjunctions-and-disjunctions)).
2.  Break after the `:` of a quantifier or set builder, indenting the body one
    level.
3.  Break before `THEN` and `ELSE`, aligning them under `IF`.
4.  Break before `IN`, aligning it under `LET`; the body follows `IN` on the
    same line ([section 4.8](#48-letin-ifthenelse-case)).
5.  For long argument lists, break after a comma and align subsequent arguments
    with the first.

```tla
AllDelivered ==
    \A m \in sent :
        \E r \in received :
            /\ r.id = m.id
            /\ r.payload = m.payload
```

Never break a line inside a tuple, record, or set literal if the literal fits on
one line.

### 4.8 LET/IN, IF/THEN/ELSE, CASE

The first `LET` binding follows `LET` on the same line; each further binding
starts a new line aligned with the first. `IN` starts a new line aligned with
`LET`, followed by two spaces and the body, so that the body aligns with the
bindings:

```tla
Transfer(from, to, amt) ==
    LET newFrom == balance[from] - amt
        newTo   == balance[to] + amt
    IN  /\ newFrom >= 0
        /\ balance' = [balance EXCEPT ![from] = newFrom, ![to] = newTo]
```

Within a `LET`, aligning the `==` of sibling bindings **is** permitted (the one
exception to [section 4.4](#44-definitions)), since bindings are read as a
table.

`IF`/`THEN`/`ELSE` that does not fit on one line puts `THEN` and `ELSE` on their
own lines, aligned with `IF`:

```tla
Next ==
    IF buffer = <<>>
    THEN \E p \in Producers : Put(p)
    ELSE \E c \in Consumers : Get(c)
```

`CASE` arms each go on their own line. The first arm follows `CASE` on the same
line; each further arm starts with `[]` indented so that the arms' conditions
align in one column. Always include an `OTHER` arm unless the arms are provably
exhaustive by `TypeOK`, and say so in a comment when they are:

```tla
Color(n) ==
    CASE n = 0 -> "red"
      [] n = 1 -> "green"
      [] OTHER -> "yellow"
```

### 4.9 Quantifiers and set builders

Quantifier bodies that are bulleted lists begin on the line after the `:`:

```tla
\A p \in Producers :
    /\ p \notin waitSet
    /\ Len(buffer) < BufCapacity
```

Bind each variable to the smallest useful set; never quantify over `Nat` or
`Int` unbounded in a formula TLC will evaluate.

Several variables bound in one quantifier are written in one binding list, not
nested: `\A x \in S, y \in T : P(x, y)` and `\E a, b \in S : Q(a, b)`. A
quantifier over a set of tuples binds the components directly:
`\E <<src, dst>> \in Links : Up(src, dst)`, not
`\E l \in Links : Up(l[1], l[2])`. The same forms apply to set builders and
function constructors. (*Summary*, footnotes 1-2 under "The Constant Operators")

### 4.10 EXCEPT

One `EXCEPT` clause per changed index. Use `@` for the old value rather than
restating the expression:

```tla
counts' = [counts EXCEPT ![p] = @ + 1]
```

Multiple updates to the **same** function go in one `EXCEPT`, separated by
commas; wrap after the comma when long. A nested update uses a single path,
`![p].count = @ + 1` or `![i][j] = v`, never an `EXCEPT` inside an `EXCEPT`.
(*Summary*, footnote 3 under "The Constant Operators")

---

## 5 Naming

### 5.1 Rules common to all identifiers

Identifiers use only ASCII letters, digits, and underscores. They are
descriptive; single-letter names are reserved for bound variables ([section
5.8](#58-bound-variable-names)). Abbreviations are avoided unless they are
standard in the problem domain (`msg`, `buf`, `ack`).

### 5.2 Module names

**UpperCamelCase**: `BoundedBuffer`, `TwoPhaseCommit`. Model-checking wrapper
modules are prefixed `MC`: `MCBoundedBuffer`. Modules that only provide
definitions (no `Spec`) may be suffixed `Defs` or `Ext`: `SequencesExt`.

### 5.3 Constant names

**UpperCamelCase**: `BufCapacity`, `MaxRetries`, `Procs`. Sets of process or
resource identifiers are plural nouns (`Producers`, `Nodes`). Bounds are
prefixed `Max` or `Min`.

**Terminology note:** Lamport names sets with singular nouns (`Message`, `Proc`,
`Adr`) so that `m \in Message` reads "m is a message" (*SS* section 4.1,
footnote). This guide chooses plural because it matches the community examples
and reads better in `\E p \in Producers`. A repository may adopt the singular
convention instead; it must then apply it to every set constant and never mix
the two.

### 5.4 Variable names

**lowerCamelCase**: `buffer`, `waitSet`, `msgsInFlight`. Variables are nouns. A
function variable indexed by process is named for what it holds, not for its
indexing: `pc`, `balance`, `votedFor`, not `perProcState`.

The tuple of all variables is always named `vars`. Partial tuples for subsystems
are named `<subsystem>Vars`: `bufVars`.

### 5.5 Operator names

**UpperCamelCase** for all defined operators that are not variables: `TypeOK`,
`Range`, `IsFull`. Predicates read as assertions: `IsEmpty(s)`, `CanDeliver(m)`.
Operators that compute values read as nouns: `NextIndex(p)`, `Candidates`.

### 5.6 Action names

**UpperCamelCase**, imperative verb phrase naming what the system does:
`Put(p)`, `Get(c)`, `SendPrepare(n)`, `Timeout(p)`. Do not prefix with `Action`
or suffix with `Step`. The next-state relation is always `Next`; the initial
predicate is always `Init`; the full specification is always `Spec`.

An action's enabling condition, when factored out, is named by prefixing `Can`:
`CanPut(p)`. Do not use an `Enabled` prefix, which invites confusion with the
`ENABLED` operator.

### 5.7 Invariant and property names

**UpperCamelCase**. The type invariant is always `TypeOK`. (*SS* uses
`TypeInvariant`; the two are interchangeable in meaning, and `TypeOK` is chosen
here because it is what the community examples, the VS Code extension's
snippets, and the learning site use.) Other state invariants are named for the
property they assert, often suffixed `Inv` when the bare name would be
ambiguous: `Mutex`, `NoDuplicatesInv`, `BalancesNonNegative`.

Temporal (liveness) properties are named for the guarantee: `Termination`,
`EventuallyDelivered`, `NoStarvation`. Safety properties expressed as temporal
formulas (`[][A]_vars`) are suffixed `Prop` to distinguish them from state
invariants, since TLC checks them with `PROPERTY`, not `INVARIANT`:
`NeverSkipYellowProp`.

The conjunction of all fairness conditions is `Fairness`. The conjunction of all
invariants, if defined, is `Inv`.

### 5.8 Bound variable names

Bound variables in quantifiers, set builders, and `CHOOSE` are **short
lowercase** names: a single letter when the set is obvious from context
(`p \in Producers`, `n \in Nodes`, `m \in msgs`), or a short lowerCamelCase noun
otherwise. Shadowing a variable or constant name with a bound variable is
forbidden.

### 5.9 Record field names

**lowerCamelCase**: `[type |-> "prepare", src |-> n, term |-> t]`. Message
records always have a `type` field whose value is a string from a declared set
of message types.

### 5.10 String values

A string value is one lowercase word: `"idle"`, `"awaiting"`. A value that
takes two or more words is **lowerCamelCase**, as a variable is:
`"sourceFile"`, `"destinationFile"`, `"otherFile"` (decided 2026-10-19; the
TLA+ references give no rule, and *SS* uses one-word strings only). A value is
named for what it is, never for its position in its set: `"sourceFile"`, not
`"a"`. A string never stands for an absent value ([section
5.11](#511-model-values)).

### 5.11 Model values

Model values in `.cfg` files are **lowercase letter followed by digits** for
anonymous members of a symmetry set (`p1, p2, p3`), or **UpperCamelCase** for
named singletons (`NoVal`, `Nil`). A model value that stands for "absent" is
named `NoVal`, `Nil`, or `None`, is **defined** in the module with `CHOOSE`
([section 6.20](#620-prefer-definitions-to-parameters)), is assigned a model
value of the same name in the `.cfg` ([section 8.4](#84-constants)), and is
never spelled as a string literal.

### 5.12 Reserved and conventional names

The following names are reserved for their conventional meaning and must not be
reused for anything else:

| Name       | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `Init`     | Initial-state predicate                              |
| `Next`     | Next-state relation                                  |
| `Spec`     | `Init /\ [][Next]_vars /\ Fairness`                  |
| `vars`     | Tuple of all declared variables                      |
| `TypeOK`   | Type-correctness invariant                           |
| `Fairness` | Conjunction of all WF/SF conditions                  |
| `Inv`      | Conjunction of all state invariants (if defined)     |
| `Sym`      | Symmetry set for TLC (`Permutations(...)`)           |
| `Constraint` | State constraint for TLC                           |
| `View`     | View expression for TLC                              |

### 5.13 User-definable operator symbols

TLA+ lets a module define its own infix operators (`a \prec b`, `s ++ t`,
`x | y`), prefix operators (`-. a`), and postfix operators (`e^+`), drawn from
the fixed list in *Summary*, "User-Definable Operator Symbols". A definition
`a \prec b == ...` is legal for any symbol in that list and for no other.

Define a symbol only when:

1.  It is the standard notation of the problem domain (`\prec` for a partial
    order, `\oplus` for an abelian operation, `\o` is already concatenation),
    **and**
2.  The symbol is not already defined by a module the spec extends. The standard
    modules claim `+ - * \div % ^ .. < > <= >=` (`Naturals`, `Integers`,
    `Reals`), `/` (`Reals` only), `\o` (`Sequences`),
    `\oplus \ominus \sqsubseteq` (`Bags`), and `:> @@` (`TLC`). Redefining one
    of these in a module that extends its owner is a SANY error; redefining it
    with a different meaning elsewhere is forbidden by this guide.

Otherwise define a named operator. `Merge(s, t)` is searchable, readable aloud,
and needs no precedence lookup; `s ** t` is none of these. A defined symbol
takes a comment giving its reading in words. Symbols from the list that are mere
ASCII art (`&&`, `%%`, `$$`, `!!`, `??`, `##`) are never defined.

Infix operators cannot be defined as *functions*, only as operators, so a symbol
is never stored in a variable or passed where a function is expected ([section
6.19](#619-functions-vs-operators)). (*SS* section 6.4)

---

## 6 Specification practices

### 6.1 Always define TypeOK

Every module with variables defines `TypeOK` as the first definition after
`vars`, and every `.cfg` checks it. `TypeOK` mentions every variable and gives
each the most precise set the author can state. Use record sets, function sets,
and `Seq(S)` rather than loose membership:

```tla
TypeOK ==
    /\ buffer \in Seq(Producers)
    /\ Len(buffer) <= BufCapacity
    /\ waitSet \subseteq Producers \cup Consumers
```

Rationale: TLA+ is untyped. `TypeOK` is the only place the state space's shape
is written down, and it is the first thing a reader looks for.

### 6.2 Init/Next/Spec pattern

Every behavioral module defines exactly `Init`, `Next`, and `Spec` with those
names. `Next` is a flat disjunction of actions (possibly existentially
quantified); it contains no primed-variable logic of its own.

```tla
Init ==
    /\ buffer = <<>>
    /\ waitSet = {}

Next ==
    \/ \E p \in Producers : Put(p)
    \/ \E c \in Consumers : Get(c)

Spec == Init /\ [][Next]_vars /\ Fairness
```

### 6.3 One action, one concept

Each action models one atomic step of the system as the implementation would
perform it. If an action's body contains a top-level disjunction, split it into
two actions. If two actions differ only in a parameter, merge them and
parameterize.

### 6.4 Guards before effects

Within an action, conjuncts are ordered: enabling conditions (unprimed only)
first, then primed assignments in `vars` order, then `UNCHANGED` last.

```tla
Get(c) ==
    /\ c \notin waitSet            \* guard
    /\ buffer # <<>>               \* guard
    /\ buffer' = Tail(buffer)      \* effect
    /\ waitSet' = waitSet \ {c}    \* effect
```

Rationale: TLC evaluates conjuncts left to right, stopping at the first `FALSE`,
and it assigns `v'` when it first meets `v' = e` or `v' \in S`. Guards first
means disabled actions are rejected before any prime is evaluated, and readers
see "when" before "what". The order is also a correctness constraint under TLC:
a primed variable used in a conjunct before the conjunct that assigns it is an
error, so `/\ y' = Append(y, x') /\ x' \in 1..3` fails where the reverse order
works. The same left-to-right rule means a guard that makes a later expression
well-defined (`x # <<>>`) must precede the expression that needs it
(`x[1] = 0`). (*SS* section 14.2.2, section 14.2.6)

### 6.5 Every action is total over the variables

Every action constrains every variable in `vars` exactly once, either by a
primed equation or by `UNCHANGED`. An action that omits a variable permits that
variable to take any value, which is almost never intended. TLC reports it as
"Successor state is not completely specified by the next-state action", naming
the action but not the missing variable. (*SS* section 14.2.6)

### 6.6 Prefer UNCHANGED

Write `UNCHANGED <<x, y>>`, not `x' = x /\ y' = y`. Write `UNCHANGED vars` for a
stuttering action, not a tuple restating every variable. List the unchanged
variables in `vars` order.

### 6.7 Prefer `\in` over `=` for nondeterministic initial states

When an initial value may be any element of a set, write `x \in S` in `Init`. Do
not write `\E v \in S : x = v`.

### 6.8 Keep models finite in the configuration, not the spec

The module describes the system; the `.cfg` describes the finite instance TLC
checks. Bounds that exist only to make model checking terminate belong in
`CONSTANT` assignments, `CONSTRAINT`, or an `MC` wrapper module, **not** in
`Next`. A guard such as `counter < 10` is acceptable only if the real system has
that bound.

### 6.9 CHOOSE discipline

`CHOOSE x \in S : P(x)` is deterministic and is **not** a way to express
nondeterminism; use `\E` in an action instead. Use `CHOOSE` only when:

1.  Exactly one element satisfies `P`, and the uniqueness is stated in a comment
    or an `ASSUME`, or
2.  Any satisfying element is equally correct and the spec never depends on
    which one (e.g., picking a representative for an abstraction).

Never apply `CHOOSE` to an empty set; the result is unspecified and TLC reports
an error.

`CHOOSE` is a *deterministic* operator: if `CHOOSE n : n \in Nat` equals 42
today it equals 42 forever, so `x' = CHOOSE n : n \in Nat` permits exactly one
behavior while `x' \in Nat` permits one for every natural number. Programmers
who expect `CHOOSE` to mean "pick one at random" write specs with far fewer
behaviors than they intended. (*SS* section 6.6)

TLC additionally does **not** preserve `CHOOSE`'s semantics across syntactically
different but equal sets: `CHOOSE x \in {1, 2, 3} : x < 3` and
`CHOOSE x \in {3, 2, 1} : x < 3` may evaluate differently. Never write a
property whose truth depends on which element a `CHOOSE` selects. (*SS* section
14.6)

### 6.10 Fairness

State fairness as a separately named conjunct, `Fairness`, built from
`WF_vars(A)` and `SF_vars(A)` on **individual actions**, never on `Next` as a
whole unless the spec genuinely requires it. Prefer weak fairness; reach for
strong fairness only when a liveness property demonstrably needs it, and comment
why.

Fairness conditions use the same subscript tuple as `Spec` (normally `vars`).
Mismatched subscripts are a common source of vacuous liveness results.

Keep `Spec` **machine closed**: `Init /\ [][Next]_vars /\ L` where `L` is a
conjunction of `WF_vars(A)` and `SF_vars(A)` for actions `A` that are disjuncts
(or sub-actions) of `Next`. Such a specification never lets the liveness part
forbid a step the safety part allowed. A liveness conjunct written as an
arbitrary temporal formula can accidentally constrain safety, and *SS* section
8.9.2 recommends avoiding that form. (*SS* section 8.4-8.6, section 8.9.2)

### 6.11 Safety before liveness

Check all invariants and action properties under a configuration **without**
liveness before adding `PROPERTY` lines for temporal formulas. Liveness checking
is far slower and its counterexamples are harder to read; a spec whose safety is
not yet established should not be liveness-checked.

Most of the benefit of a specification comes from its safety part; the liveness
part is typically under five percent of the text and is easy enough to write
that there is no reason to omit it, but the effort spent *looking for errors*
goes into safety. (*SS* section 8.9.5)

Be suspicious when TLC reports no liveness violation: a finite model can mask
them. Be equally suspicious when a safety property passes, because the easiest
way to satisfy a safety property is to do nothing. For every action, confirm
that TLC *can* reach a state only that action produces, by temporarily checking
the negation of a reachability predicate and watching it fail. (*SS* section
14.3.5, section 14.5.3 "Be Suspicious of Success")

### 6.12 Symmetry

Declare a symmetry set only when the specification and **every checked
property** are invariant under permutation of that set's elements. TLC does not
verify this; an unsound declaration hides bugs, and when TLC does find one it
may be unable to print the trace ("Failed to recover the state from its
fingerprint"). Never use `SYMMETRY` when checking liveness properties: TLC "may
miss errors, report an error that doesn't exist, or report a real error with an
incorrect counterexample". Define the symmetry expression as
`Sym == Permutations(Procs)` in the `MC` wrapper module ([section
6.14](#614-avoid-tlc-only-operators-in-the-model)) so the `.cfg` can refer to it
by name. (*SS* section 14.3.4; TLA+ By Example, "Symmetry Sets")

### 6.13 Deadlock

Leave TLC's deadlock check enabled unless terminal states are intentional. When
they are, model termination explicitly with a stuttering action and disable the
check in the `.cfg` with a comment explaining why:

```tla
Finished ==
    /\ \A a \in Accounts : ~active[a]
    /\ UNCHANGED vars
```

### 6.14 Avoid TLC-only operators in the model

The `TLC` module (*SS* section 14.4; *Summary*, "Module TLC") defines `Print`,
`Assert`, `JavaTime`, `Permutations`, `SortSeq`, and the function constructors
`:>` and `@@`; later releases added `PrintT`, `RandomElement`, `TLCGet`,
`TLCSet`, and others. All but `:>` and `@@` are debugging or model-configuration
aids. They belong in a separate wrapper module `MCFoo.tla` that `EXTENDS Foo`
and is what the `.cfg` actually checks, **not** in the module describing the
system. Temporary `Print` calls added while debugging are removed before commit.

`d :> e` (the one-element function `[x \in {d} |-> e]`) and `f @@ g` (function
merge, left-biased) are ordinary mathematical definitions and may appear in the
system module, but they still require `EXTENDS TLC`. Prefer `[x \in S |-> e]`
when the domain is expressible as a set, and reserve `:>`/`@@` for building a
function from a handful of explicit points: `"a" :> 1 @@ "b" :> 2`.

### 6.15 Prefer records over tuples for structured data

Use records (`[type |-> "ack", src |-> n]`) rather than positional tuples
(`<<"ack", n>>`) for any structured value with more than one field. Records are
self-documenting, and `EXCEPT !.field` reads better than `EXCEPT ![2]`. Tuples
are for sequences and for pairs whose order is intrinsic (`<<x, y>>`
coordinates).

### 6.16 Recursion

Prefer the standard-module operators (`Cardinality`, `SelectSeq`, `FoldSeq` from
community modules) and the set-theoretic operators (`UNION`, `SUBSET`, set
builders) over hand-written recursion; `Head`, `Tail`, and `\o` are all defined
without it. Recursion is a programming habit, not a mathematical necessity, and
a non-recursive definition is usually both shorter and easier to reason about.
(*SS* section 6.3)

When recursion is necessary, prefer a **recursive function definition** with an
explicit, finite domain, which is what the language was designed for:

```tla
Sum[s \in Seq(Nat)] == IF s = <<>> THEN 0 ELSE Head(s) + Sum[Tail(s)]
```

`RECURSIVE Op(_)` for recursive *operators* is a later addition to the language
and is acceptable when the operator must take an operator argument or must apply
to values of no fixed set, but it needs a comment stating why a function would
not do. Mutual recursion is not supported for either form; encode mutually
recursive functions as one record-valued function (*SS* section 6.3).

A recursive function definition `f[x \in S] == e` is an abbreviation for
`f == CHOOSE f : f = [x \in S |-> e]` and does not by itself define a function:
if no such `f` exists (e.g., `circ[n \in Nat] == CHOOSE y : y # circ[n]`), `f`
is some unspecified value. Every recursive definition therefore comes with a
comment stating why the recursion is well-founded. (*SS* section 6.3)

### 6.17 INSTANCE and LOCAL

Use `INSTANCE M WITH ...` to import a module with substitutions and
`LOCAL INSTANCE` or `LOCAL` definitions to keep helpers from leaking into
modules that `EXTENDS` yours. Parameterized instances
(`Q(n) == INSTANCE Queue WITH id <- n`) are preferred over copying definitions.

Rules for `INSTANCE` (*SS* section 4.2):

-   Every parameter of the instantiated module must be substituted. Omit a
    substitution only when it would be `p <- p`; never rely on implicit
    substitution for a parameter whose name differs in meaning between the two
    modules.
-   Name instances for the role they play, not the module they instantiate:
    `InChan == INSTANCE Channel WITH chan <- in`, not `Chan1`.
-   Use unrenamed `INSTANCE M WITH ...` only when the module has exactly one
    instance; two instances always get distinct prefixes.
-   Instance prefixes are written with no spaces around `!`: `InChan!Send(d)`.

Structure modules so that a reader can read the spec in the order that is
easiest to understand, even when that is not the order the language forces
(definition before use). Use `INSTANCE`, module splitting, and guiding comments
("Actions Send and Rcv below are the disjuncts of Next") to make a top-down
reading possible. (*SS* section 3.5)

### 6.18 PlusCal

When a module contains a PlusCal algorithm:

-   The algorithm lives inside a block comment immediately before the
    `\* BEGIN TRANSLATION` marker.
-   Use one PlusCal syntax (P-syntax or C-syntax) throughout a repository;
    neither *SS* nor TLA+ By Example covers PlusCal, so this guide does not
    prefer one.
-   Label every atomic step; never rely on the translator's auto-labeling.
-   The generated TLA+ between `\* BEGIN TRANSLATION` and `\* END TRANSLATION`
    is committed but **never edited by hand**.
-   Invariants and properties are written **after** `\* END TRANSLATION` in
    plain TLA+, not in PlusCal `define` blocks, so that they survive
    retranslation and are visible to readers who skip the algorithm.

### 6.19 Functions vs. operators

TLA+ has both functions (`[x \in S |-> e]`, applied with `f[x]`) and operators
(`Op(x) == e`, applied with `Op(x)`). They are not interchangeable (*SS* section
6.4):

-   A function is a **value**: it has a `DOMAIN`, can be stored in a variable,
    put in a set, compared with `=`, and updated with `EXCEPT`. Applying it
    outside its domain yields a silly expression ([section
    6.26](#626-dont-assume-different-looking-values-are-unequal)).
-   An operator is **not a value**: it has no domain, can be applied to any
    argument, can take operators as arguments, and cannot be stored or compared.

Default to **operators** for definitions. Use a **function** when the
specification needs the value itself: state stored in a variable
(`balance \in [Accounts -> Nat]`), an element of a set, a recursively defined
object (`f[n \in Nat] == ...`), or the target of `EXCEPT`. Never define an
operator and then write `Op[x]`, and never define a function `f` and then write
`f(x)`; SANY rejects both, but choosing the wrong kind first wastes a
round-trip.

### 6.20 Prefer definitions to parameters

Introduce a `CONSTANT` only for something the specification genuinely leaves
open (the set of data values, a buffer bound). When a value can be *defined*,
define it:

```tla
\* Not: CONSTANT NoVal with ASSUME NoVal \notin Val.
NoVal == CHOOSE v : v \notin Val
```

Every parameter is something the reader must hold in their head and the model
must assign; definitions cost neither. (*SS* section 5.1)

TLC cannot evaluate an unbounded `CHOOSE`, so a definition of this form is
overridden in the `.cfg` by assigning the symbol a model value of the same
name -- `NoVal = NoVal` -- which TLC then uses in place of the definition and
prints under that name in traces. This is the one case in which a *defined*
symbol appears in a `CONSTANTS` block. (*SS* section 14.2.3)

### 6.21 Hiding internal variables

A variable that exists only to describe the system's internals (a queue inside a
FIFO box) is *internal*. The formally correct way to hide it is temporal
existential quantification via a parameterized instance:

```tla
---- MODULE FIFO ---------------------------------------------------------------
CONSTANT Message
VARIABLES in, out

Inner(q) == INSTANCE InnerFIFO

Spec == \EE q : Inner(q)!Spec
================================================================================
```

Name the visible module for the system (`FIFO`) and the module with the internal
variable `Inner<Name>` (`InnerFIFO`). Use this idiom only when a hidden-variable
spec is actually needed (refinement, composition, or a published interface). For
most applications, write the inner specification and state in the module comment
which variables are visible and which are internal; TLC cannot check `\EE`
formulas directly. (*SS* section 4.3, section 10.6.2)

### 6.22 Closed-system specifications

Write **closed-system** specifications: `Spec` describes the correct behavior of
both the system and its environment. Open-system specifications (system correct
*or* environment misbehaved first) are philosophically nicer but harder to write
and reason about, and are rarely needed in practice. Mark the environment/system
split with `SysNext`/`EnvNext` ([section 3.8](#38-specification-and-properties))
instead. (*SS* section 4.5, section 10.7)

### 6.23 Choosing the grain of atomicity

The hardest part of writing a specification is choosing the abstraction: which
variables represent the state, and how much happens in one step. A spec is an
abstraction; every detail omitted is a potential source of error, and every
detail kept is cost. Rules of thumb (*SS* section 3 intro, section 7.3):

-   Represent one conceptual step of the system as one action, even if the
    implementation performs it in several physical steps, **unless** the
    intermediate states can be observed by another part of the system. The test
    (*SS* section 7.3): a coarse step `R \cdot L` may replace the two fine steps
    `R` then `L` only if every other action commutes with at least one of
    them -- leaves unchanged every variable it changes, and neither enables nor
    disables it. If some action can observe the state between `R` and `L`, the
    finer grain is required.
-   Never use the action-composition operator `\cdot`. It "rarely appears in an
    actual specification"; if tempted, restructure the actions. (*SS* section
    7.3, footnote)
-   Specify the parts of the system most likely to hide errors: concurrency and
    the interaction of asynchronous components. Data-structure layout (byte
    offsets, argument marshalling) is modeled only when errors there are a real
    risk, because it complicates the spec for everything else. (*SS* section
    7.2, section 7.4)
-   Use separate variables for separately observable quantities; merge
    quantities that always change together into one record-valued variable.
-   Record in the module comment every atomicity decision that discards an
    observable intermediate state ("`val` and `rdy` change in one step; the
    implementation must stabilize `val` before raising `rdy`").

### 6.24 Start from sample behaviors

Before writing `Init` and `Next`, write the first few states of one or two
sample behaviors as a comment or in the design doc. This settles the variables
and the step granularity before any formula is written. The resulting
specification is then built in this order: declarations, `TypeOK`, `Init`, the
actions, `Next`, `Spec`, the theorem. (*SS* section 3, section 7.5)

### 6.25 Don't be too clever

A specification is read many more times than it is written, usually by people
who know less TLA+ than its author. Write the obvious formula, even if a
cleverer one is shorter. If two formulations are provably equivalent, choose the
one that is easiest to understand; if they are not equivalent, you must decide
which one you mean, and say so. (*SS* section 2.5, section 7.6)

Concretely, **the new value of a variable `v` is specified by a conjunct of the
form `v' = exp` or `v' \in exp`, where `exp` contains no primes.** Anything
cleverer is probably wrong: `q = <<h'>> \o q'` looks like a compact way to pop a
queue, but it is satisfied by non-sequence values of `h'` and `q'` because `\o`
is unspecified on non-sequences. (*SS* section 7.6)

Likewise specify a whole function, not its values pointwise:
`f' = [i \in S |-> e]`, not `\A i \in S : f'[i] = e`. The second does not even
imply that `f'` is a function. (*SS* section 6.5)

### 6.26 Don't assume different-looking values are unequal

The rules of TLA+ do not imply `1 # "a"`. Expressions like `3 / "abc"` are
*silly*: they have a value, but no one knows what it is. A formula may contain a
silly expression, but its truth must never depend on one. (*SS* section 6.2)

Therefore:

-   A value that may be one of several kinds is a **record with a `type`
    field**, never a bare union: `[type |-> "Nat", value |-> 1]` and
    `[type |-> "String", value |-> "a"]` are distinguishable because their
    `type` fields are both strings; `1` and `"a"` may not be. (*SS* section 7.6)
-   A sentinel meaning "no value" is defined as `CHOOSE v : v \notin S`, not as
    a string or number assumed to be "obviously" outside `S`. (*SS* section 5.1)
-   `TypeOK` makes every disjointness the spec relies on explicit. TLC enforces
    this at run time: a number and a string are *not comparable*, so evaluating
    `1 = "a"` is reported as an error, not as `FALSE`. A set that mixes them is
    not even a TLC value. (*SS* section 14.2.1, section 14.7.2)

### 6.27 Move quantification to the outside

Write

```tla
Next == \E p \in Procs : Step(p)
```

not an unquantified `Next` whose actions each contain their own
`\E p \in Procs`. Outer quantification makes the parameter visible in
`WF_vars(Step(p))`, in trace output, and in refinement mappings, and it keeps
each action a formula about one process. (*SS* section 7.6)

### 6.28 Prime only variables

A prime distributes over everything inside the expression it is applied to:
`f[e]'` equals `f'[e']`, which equals `f'[e]` only if `e` contains no variables.
If `op(a) == x + a` with `x` a variable, then `op(y)'` is `x' + y'`, and there
is **no way** to write `x' + y` using `op` and `'`. (`op'(y)` is illegal: only
an expression, not an operator, can be primed.) (*SS* section 7.6)

Therefore, prime **only variables**:

-   Write `f'[i]`, not `f[i]'`, when you mean the new function at the old index.
-   Never prime an applied operator (`Op(x)'`) or a `LET`-bound name whose
    definition mentions a variable; expand it and prime the variables.
-   Write `UNCHANGED vars`, not `vars' = vars`.
-   Priming anything that already contains a prime, a temporal operator, or a
    bound variable from an outer quantifier is an error. (*SS* section 16.2.3)

### 6.29 Keep temporal formulas in canonical form

Temporal logic is confusing; the TLA style is to use as little of it as
possible. Every behavioral specification is written as

```tla
Spec == Init /\ [][Next]_vars /\ Fairness
```

and every property is one of: an invariant `Inv` (checked as `[]Inv`), an action
property `[][A]_vars`, a leads-to `P ~> Q`, or `<>[]P`/`[]<>P`. Nested or exotic
temporal formulas (`[]<>[]`, `<>` under `\E`) require a comment explaining why
the simpler form is insufficient. (*SS* section 8.9.6)

### 6.30 A type invariant is not an assumption

`TypeOK` is a *definition*, and a definition assumes nothing. If `TypeOK`
asserts `n \in Nat`, the conjunct `n' > 7` in an action still does **not** say
that `n'` is a natural number greater than 7; it is satisfied by `n' = sqrt(96)`
and, since we do not know whether `"abc" > 7`, possibly by `n' = "abc"`. Every
action must therefore constrain each changed variable to a set, either directly
(`n' \in {m \in Nat : m > 7}`) or through the form `v' = exp` with a well-typed
`exp`. `TypeOK` is what you *prove* holds; it is not what makes the actions
well-typed. (*SS* section 7.6)

Do not "fix" this by conjoining `[]TypeOK` to `Spec`. Keep
`Init /\ [][Next]_vars /\ Fairness` and make `Next` imply the types. (*SS*
section 7.6, footnote)

### 6.31 Don't be too abstract

An abstraction should not blind the specification to what the real system can
do. Modeling a keyboard as a single `KeyStroke(k, typ, typ')` step is simpler
than modeling `Press(k)` and `Release(k)`, but it cannot express two keys being
held at once -- and so cannot reveal a bug that depends on it. When in doubt,
use the more concrete representation that more accurately describes the real
system; if a coarser abstraction is chosen, the module comment records that the
omitted behavior was deliberately excluded. (*SS* section 7.6)

### 6.32 Write comments as comments

Never encode an explanatory remark as a vacuous formula. The idiom

```tla
A ==
    \/ /\ x >= 0
       /\ ...
    \/ /\ x < 0
       /\ FALSE      \* "A is not enabled when x < 0"
```

is logically identical to its first disjunct (`F \/ FALSE = F`), so the second
disjunct is a comment written in the wrong language. Write

```tla
A ==
    /\ x >= 0        \* A is not enabled when x < 0.
    /\ ...
```

The same applies to redundant guards that restate `TypeOK`, and to `UNCHANGED`
of a variable the action could not have changed. (*SS* section 7.6)

### 6.33 Specify during design, not after

Write the specification while the system is being designed, not once it is
complex enough to need one. An initial spec may be incomplete: an action whose
enabling condition is not yet known, or a value "to be determined", is written
with a `TODO` comment and a placeholder, and omitted functionality is added
later as new disjuncts of `Next`. Tools can be run on these drafts to find
design errors early. (*SS* section 7.7)

```tla
\* TODO(pippi): Enabling condition not yet designed.
RdMiss(p) ==
    /\ memQ' = Append(memQ, buf[p])
    /\ ctl' = [ctl EXCEPT ![p] = "?"]       \* TODO(pippi): decide value
    /\ UNCHANGED <<memInt, wmem, buf, cache>>
```

A placeholder value is a string such as `"?"` that `TypeOK` does not admit, so
the draft fails type-checking until it is resolved.

---

## 7 Comments

### 7.1 Comment syntax

Line comments use `\*` followed by one space. Block comments use `(* ... *)`.
Boxed block comments (a border of `*` characters padded to the column limit) are
used **only** for the module-level description after the header. All other block
comments are unboxed.

**Terminology note:** Lamport's own convention (*SS* section 15.2.3) is a boxed
`(* ... *)` block placed to the *right* of each action, one comment line per
conjunct, which `tla2tex` renders as a side note. This guide does not adopt it,
because such a box is four separate comments to the parser, is fragile under the
80-column limit, and reflows badly in diffs. A repository that typesets its
specs with `tla2tex` may adopt it instead, uniformly.

Unboxed block comment:

```tla
(* An item is "stuck" if its producer is waiting and the buffer has space;
   this should be unreachable and is checked by StuckInv. *)
```

A comment appears on a line by itself or at the end of a line. The language
permits a comment between a definition's name and its `==` (*SS* section 3.5
shows one "just to show that it can be done"); this guide forbids it, along with
comments inside an expression. `(* *)` comments nest, so a block of definitions
can be commented out during debugging; such a block is never committed ([section
7.3](#73-where-comments-are-discouraged)).

Comments are the informal explanation of how the mathematics relates to the real
system, and every specification needs that explanation -- either as comments or
in an accompanying document that the module comment links to. Write comments
**as you go**; a specification written first and commented later ends up with
comments that describe what the author remembers rather than what the formulas
say. (*SS* section 3.5, section 7.6)

### 7.2 Where comments are required

1.  The module description ([section 3.2](#32-module-header)).
2.  Every `CONSTANT` and `VARIABLE` declaration.
3.  Every action, stating in prose what step of the system it models and, where
    non-obvious, why its guard is what it is.
4.  Every invariant and property, stating the informal claim.
5.  Every `CHOOSE` ([section 6.9](#69-choose-discipline)).
6.  Every `SF_` fairness condition ([section 6.10](#610-fairness)).
7.  Every `CHECK_DEADLOCK FALSE`, `CONSTRAINT`, and `SYMMETRY` in a `.cfg`.
8.  Any deliberate deviation from this guide.

### 7.3 Where comments are discouraged

Do not restate the formula in English ("`x' = x + 1` increments x"). Do not keep
commented-out definitions; delete them. Do not maintain a changelog after the
footer.

### 7.4 TODO comments

```tla
\* TODO(username): Model message loss once the retry path is specified.
```

---

## 8 TLC configuration files

### 8.1 Structure

A `.cfg` file lists its keywords in this order, one keyword block per section,
blank line between blocks:

```text
\* Model: three producers, two consumers, capacity 2. Expected to deadlock.

SPECIFICATION Spec

CONSTANTS
    Producers = {p1, p2, p3}
    Consumers = {c1, c2}
    BufCapacity = 2

INVARIANTS
    TypeOK
    NoStarvationInv

PROPERTIES
    EventuallyConsumed

SYMMETRY Sym

CHECK_DEADLOCK TRUE
```

Comments in `.cfg` files use `\*`.

### 8.2 One model, one file

Each distinct model (set of constant values and properties) is its own file.
`Foo.cfg` is the smallest model that exercises every action and is expected to
pass; it is what CI runs. Larger or failing-by-design models are
`Foo_<Description>.cfg` (`BoundedBuffer_Deadlock.cfg`,
`BoundedBuffer_Large.cfg`), each with a leading comment stating its purpose and
expected outcome.

### 8.3 Prefer SPECIFICATION over INIT/NEXT

Use `SPECIFICATION Spec`. `INIT`/`NEXT` is permitted only in teaching material
or when the module has no `Spec` definition. A configuration cannot have both;
and under `INIT`/`NEXT` there is no way to state fairness, so a liveness
property that depends on it will be reported as violated by the stuttering
behavior. (*SS* section 14.7.1; TLA+ By Example, "TLC Configuration")

### 8.4 Constants

Use `CONSTANTS` (plural) with one assignment per line, indented 4 spaces.
Members of a symmetry set are model values, not strings or numbers.

Two forms appear in a `CONSTANTS` block (*SS* section 14.2.3):

-   **Assignment** `c = v`, where `v` is a primitive value, a model value, or a
    finite set of them. `c` is normally a declared constant; it may be a
    *defined* symbol only to override a definition TLC cannot evaluate ([section
    6.20](#620-prefer-definitions-to-parameters)), in which case the model value
    carries the same name: `NoVal = NoVal`.
-   **Replacement** `c <- d`, where `d` is an operator defined in the `MC`
    module. Used to give a value to an operator-valued constant
    (`Send <- MCSend`) or to substitute a TLC-friendly definition for one that
    is correct but slow (`Sort <- FastSort`). Every replacement has a comment in
    the `MC` module stating that `d` equals `c` on the model's values.

### 8.5 Invariants and properties

Use the plural keywords `INVARIANTS` and `PROPERTIES`, one name per line.
`TypeOK` is always listed first. State invariants go under `INVARIANTS`;
anything containing a temporal operator or a primed variable goes under
`PROPERTIES`. Listing a temporal formula under `INVARIANTS` is an error that TLC
reports; listing a state predicate under `PROPERTIES` works but is slower and is
forbidden.

### 8.6 State-space controls

`CONSTRAINT`, `ACTION_CONSTRAINT`, `VIEW`, and `SYMMETRY` each require a comment
stating the justification. `CONSTRAINT` and `VIEW` must not be used with
liveness properties unless the author has verified soundness.

### 8.7 Model-checking workflow

These are working practices rather than file-format rules; they are listed here
because the `.cfg` files in a repository are the evidence that they were
followed. (*SS* section 14.5.3)

1.  **Start small.** The first model gives every set one element and every queue
    length one. An untested spec probably has many errors, and a tiny model
    finds the simple ones in seconds. Grow the model gradually; the reachable
    state count is exponential in the parameters.
2.  **Name every invariant conjunct separately.** When `Inv == A /\ B /\ C`
    fails, TLC cannot say which of `A`, `B`, `C` was false. List `A`, `B`, `C`
    individually under `INVARIANTS` so the report names the culprit.
3.  **Be suspicious of success.** See [section
    6.11](#611-safety-before-liveness). A model that passes everything on the
    first run is more likely under-constrained than correct. For liveness in
    particular, confirm that TLC is doing the check you expect by giving it a
    liveness property the spec does *not* satisfy and verifying it reports an
    error, and confirm that the finite model admits infinite behaviors
    satisfying the fairness conditions (a `CONSTRAINT` can make every fairness
    condition vacuously true). (*SS* section 14.3.5)
4.  **Check everything you can.** Every state predicate the author believes is
    invariant is listed under `INVARIANTS`, even ones that follow from others;
    discovering that one is *not* invariant teaches something about the spec.
5.  **Don't start over after every error.** After fixing a bug found deep in a
    long run, re-check from the error state: define `ErrorState` as the last
    state in the trace, use it as `INIT` in a throwaway `Foo_Resume.cfg`, and
    confirm the fix before re-running from scratch. Model values appearing in
    the trace must be declared as `CONSTANTS` in the `MC` module and assigned to
    themselves (`d1 = d1`) in the `.cfg`. Throwaway resume configurations are
    not committed.
6.  **Use TLC as a calculator.** A module consisting only of `ASSUME`
    statements, with an empty `.cfg`, evaluates its assumptions and reports any
    that are false. This is the fastest way to check an understanding of an
    operator or a tautology before relying on it in a spec.

TLC treats strings as primitive values rather than sequences (so `"abc"[2]` is
an error), and the book's TLC bounds integer arithmetic to `-2^31 .. 2^31 - 1`;
check the current release notes before relying on larger values. (*SS* section
14.6)

---

## 9 Appendix: a complete example

```tla
---- MODULE BoundedBuffer ------------------------------------------------------
(***************************************************************************)
(* A bounded FIFO buffer shared between producer and consumer threads,     *)
(* modeled after the single-condition-variable Java implementation in      *)
(* Kuppe's BlockingQueue tutorial. A producer appends its own identifier   *)
(* as the item so that buffer contents are observable in traces.           *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    Producers,      \* Set of producer process identifiers
    Consumers,      \* Set of consumer process identifiers
    BufCapacity     \* Maximum number of elements the buffer can hold

ASSUME AssumeDisjoint == Producers \cap Consumers = {}
ASSUME AssumeCapacity == BufCapacity \in Nat \ {0}

VARIABLES
    buffer,     \* Sequence of produced items, oldest first
    waitSet     \* Set of processes blocked on the condition variable

vars == <<buffer, waitSet>>

--------------------------------------------------------------------------------

TypeOK ==
    /\ buffer \in Seq(Producers)
    /\ Len(buffer) <= BufCapacity
    /\ waitSet \subseteq Producers \cup Consumers

Range(f) == {f[x] : x \in DOMAIN f}

\* Wake one arbitrary waiting process, if any. The implementation calls
\* notify(), which picks nondeterministically; \E models that choice.
Notify ==
    IF waitSet = {}
    THEN waitSet' = waitSet
    ELSE \E t \in waitSet : waitSet' = waitSet \ {t}

\* Add the running process to the wait set.
Wait(t) ==
    /\ waitSet' = waitSet \cup {t}
    /\ UNCHANGED buffer

--------------------------------------------------------------------------------

Init ==
    /\ buffer = <<>>
    /\ waitSet = {}

\* Producer p appends an item if there is room, else blocks.
Put(p) ==
    /\ p \notin waitSet
    /\ \/ /\ Len(buffer) < BufCapacity
          /\ buffer' = Append(buffer, p)
          /\ Notify
       \/ /\ Len(buffer) = BufCapacity
          /\ Wait(p)

\* Consumer c removes the oldest item if present, else blocks.
Get(c) ==
    /\ c \notin waitSet
    /\ \/ /\ buffer # <<>>
          /\ buffer' = Tail(buffer)
          /\ Notify
       \/ /\ buffer = <<>>
          /\ Wait(c)

Next ==
    \/ \E p \in Producers : Put(p)
    \/ \E c \in Consumers : Get(c)

Fairness ==
    /\ \A p \in Producers : WF_vars(Put(p))
    /\ \A c \in Consumers : WF_vars(Get(c))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The system is deadlocked if every process is waiting. The implementation
\* is known to reach this state for some configurations; see the tutorial.
NoDeadlockInv == waitSet # Producers \cup Consumers

\* Every produced item is eventually consumed.
EventuallyConsumed ==
    \A p \in Producers : (p \in Range(buffer)) ~> (p \notin Range(buffer))

THEOREM Spec => []TypeOK

================================================================================
```

```text
\* BoundedBuffer.cfg
\* Minimal model: one producer, one consumer, capacity 1. Expected to pass.

SPECIFICATION Spec

CONSTANTS
    Producers = {p1}
    Consumers = {c1}
    BufCapacity = 1

INVARIANTS
    TypeOK
    NoDeadlockInv

PROPERTIES
    EventuallyConsumed

CHECK_DEADLOCK TRUE
```

---

*Derived from [TLA+ By Example](https://learning.tlapl.us/)
(tlaplus/tla-by-example), the BlockingQueue tutorial by Markus Kuppe (MIT),
Leslie Lamport, [*Specifying
Systems*](https://lamport.azurewebsites.net/tla/book-02-08-08.pdf)
(Addison-Wesley, 2002; chapters 1-8, 10, 14-16), and Lamport's [*Summary of
TLA+*](https://lamport.azurewebsites.net/tla/summary-standalone.pdf) reference
card. The appendix specification was checked with TLC 2.19. This guide is
released under CC BY 4.0.*
