import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Zero-touch provisioning for fleet installs.
 *
 * An employee never sees the setup or login window when a provisioning payload
 * is present before first launch. The payload is a JSON file, deployed per
 * device (MDM, scp, or manual), containing:
 *
 *     { "serverUrl": "https://api.work.frai.pro", "token": "...", "refreshToken": "...",
 *       "userId": "...", "tenantId": "...", "organizationId": "...", "employeeId": "..." }
 *
 * `token`/`refreshToken` come from a one-time admin login for that employee;
 * the agent keeps its session alive via refresh tokens afterwards. The file
 * can be deleted after first successful launch — tokens live in the store.
 */

export interface ProvisionPayload {
	serverUrl: string;
	token: string;
	refreshToken: string;
	userId: string;
	tenantId: string;
	organizationId: string;
	employeeId?: string;
}

/** The `auth` store shape every consumer expects (see AUTH_SUCCESS handler in ipcMain.ts). */
function authFrom(payload: ProvisionPayload) {
	return {
		token: payload.token,
		refreshToken: payload.refreshToken,
		userId: payload.userId,
		tenantId: payload.tenantId,
		organizationId: payload.organizationId,
		...(payload.employeeId ? { employeeId: payload.employeeId } : {}),
		user: {
			id: payload.userId,
			tenantId: payload.tenantId,
			employee: {
				id: payload.employeeId,
				tenantId: payload.tenantId,
				organizationId: payload.organizationId
			}
		},
		isLogout: false
	};
}

export async function applyProvisioning(store: {
	get: (k: string) => unknown;
	set: (v: Record<string, unknown>) => void;
}): Promise<boolean> {
	for (const candidate of provisionCandidates()) {
		try {
			const raw = await fs.readFile(candidate, 'utf8');
			const payload = JSON.parse(raw) as ProvisionPayload;
			if (!payload?.token || !payload?.serverUrl) {
				continue;
			}
			const auth = store.get('auth') as Record<string, unknown> | undefined;
			if (auth?.token) {
				// Already provisioned/logged in; drop the file so tokens don't linger.
				await fs.rm(candidate, { force: true }).catch(() => undefined);
				return false;
			}
			store.set({
				configs: { serverUrl: payload.serverUrl, isSetup: true, isLocalServer: false },
				auth: authFrom(payload)
			});
			await fs.rm(candidate, { force: true }).catch(() => undefined);
			return true;
		} catch {
			// Missing or malformed candidate; try next.
		}
	}
	return false;
}

function provisionCandidates(): string[] {
	const userData = app.getPath('userData');
	const fileName = process.env.HELLEYEAH_PROVISION_FILE || 'provision.json';
	// Absolute env path wins; otherwise userData/<name>.
	const abs = path.isAbsolute(fileName) ? [fileName] : [path.join(userData, fileName)];
	return [...abs, path.join(userData, 'provision.json')];
}
