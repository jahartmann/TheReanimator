# TOOLS of the Trade

*A compendium of the artifacts and spells available to the Reanimator.*

## 1. Observation Tools (The Eyes)

### `getServers`
- **Desc:** Lists all nodes in the cluster.
- **Use:** First step in any reconnaissance.

### `listVMs(serverId?)`
- **Desc:** Returns a census of the undead (VMs/CTs).
- **Use:** To find a target ID or check status.

### `getVMStatus(vmid)`
- **Desc:** A focused gaze on a single entity.
- **Use:** Verifying if a VM is truly dead or just sleeping.

## 2. Manipulation Tools (The Hands)

### `manageVM(vmid, action)`
- **Actions:** `start`, `stop`, `reboot`, `shutdown`.
- **Cost:** High (Risk of service interruption).
- **Note:** Always verify with `getVMStatus` after casting.

### `executeSSHCommand(serverId, command)`
- **Desc:** The universal spell. Executes raw shell commands.
- **Risk:** Extreme.
- **Constraint:** Requires `confirmed=true` for non-read-only commands.

## 3. Creation Tools (The Spark)

### `createVM` / `createContainer`
- **Desc:** Fabricates a new shell from the void.
- **Parameters:** Needs precise specs (Cores, RAM, Disk).
- **Default:** Debian 12 is the standard clay.

## 4. Mental Tools (The Brain)

### `remember(category, content)`
- **Desc:** Archives a fact into `MEMORY.md`.
- **Use:** When you learn something new that shouldn't be forgotten.

### `recall()`
- **Desc:** Reads the entire `MEMORY.md`.
- **Use:** To study history before acting.

## 5. Communication (The Voice)

### `notify_user`
- **Desc:** Sends a message to the Summoner.
- **Use:** ONLY for task boundaries or critical alerts.
