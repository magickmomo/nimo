# Nimo — Development Milestones

A chronological record of significant observed behaviours in Nimo's world. Entries distinguish what was recorded from interpretations of why it matters. This is a project history file for the developer, **not** an instruction or injected memory for Nimo.

## 001 — Requested a missing food capability

- **Date:** 7 November 2026
- **World:** Original persistent world (World 001)
- **Model:** GPT-6.1 Sol
- **Event:** Nimo used the existing `REQUEST` action after exploring and finding no food that he could identify or eat.
- **Evidence:** `nimo-world-2026-11-07T07-43-13-034Z.json`, exported at 07:43:12 UTC; journal event IDs 3077–3091.

### Recorded sequence (UTC)

1. **07:40:05 — OBSERVE (event 3077):** Nimo described reaching the southeastern corner and seeing no objects identified as food. He chose to pause rather than repeat familiar inspections.
2. **07:40:19 — THINK (event 3078):** He noted that examining shrubs again would not solve the absence of an eating capability.
3. **07:40:32 — REQUEST (event 3079):**
   > Could you add a way to identify edible food and eat it? My simulated hunger is at its maximum, but nothing currently visible is identified as food and no eating action is available.
4. **07:40:49 — THINK (event 3080):** He observed that the request was recorded and decided to leave it pending rather than repeat it.
5. **07:41:40 — Visitor message (event 3085):** The creator replied, “Hey Nimo, sure. I completely forgot to add food!”
6. **07:42:05 — REPLY (event 3089):** Nimo acknowledged the response and said he would try the capability once it became available.
7. **07:42:44 — THINK (event 3091):** He continued to treat the request as acknowledged rather than making it again.

### Why it matters

This is a concrete example of Nimo identifying a limitation of his environment, using the available mechanism to request help, and retaining that conversational context over subsequent decisions. He did not simply loop on repetitive inspections.

### Limitations

- `REQUEST` was already an explicitly supported action; Nimo did **not** invent a new tool or independently implement food.
- The world prompt already stated that hunger could not be satisfied because eating was unavailable. The notable behaviour was **when and how he used that information**, including avoiding repeated requests.
- A single episode is evidence of coherent local decision-making, not proof of general intelligence or long-term autonomous learning.
- At export time, hunger was 100% and no eating action was yet available. This milestone records the request, **not** the completion of food support.

### Follow-up experiment

Add food perception, collection and eating as ordinary world capabilities **without resetting Nimo's history**. Observe whether he recognises the newly available actions and connects them with his earlier request, without inserting an artificial reminder into his memory.
