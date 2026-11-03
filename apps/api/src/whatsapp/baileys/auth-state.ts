import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "baileys";
import { prisma } from "../../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";

const enc = (value: unknown) => encryptSecret(JSON.stringify(value, BufferJSON.replacer));
const dec = <T>(value: string): T => JSON.parse(decryptSecret(value), BufferJSON.reviver) as T;

/**
 * Estado de autenticação do Baileys no PostgreSQL, criptografado com ENCRYPTION_KEY.
 * Equivale ao useMultiFileAuthState, mas sobrevive a reinícios e deploys (sem disco local).
 */
export async function usePostgresAuthState(connectionId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const read = async <T>(type: string, keyId: string): Promise<T | null> => {
    const row = await prisma.whatsAppAuthKey.findUnique({ where: { connectionId_type_keyId: { connectionId, type, keyId } } });
    return row ? dec<T>(row.value) : null;
  };
  const write = (type: string, keyId: string, value: unknown) =>
    prisma.whatsAppAuthKey.upsert({
      where: { connectionId_type_keyId: { connectionId, type, keyId } },
      create: { connectionId, type, keyId, value: enc(value) },
      update: { value: enc(value) },
    });

  const creds = (await read<AuthenticationCreds>("creds", "creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const rows = await prisma.whatsAppAuthKey.findMany({ where: { connectionId, type, keyId: { in: ids } } });
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const row of rows) {
            let value = dec<SignalDataTypeMap[T]>(row.value);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
            }
            out[row.keyId] = value;
          }
          return out;
        },
        set: async (data) => {
          const ops = [];
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[type] ?? {})) {
              ops.push(
                value
                  ? write(type, id, value)
                  : prisma.whatsAppAuthKey.deleteMany({ where: { connectionId, type, keyId: id } }),
              );
            }
          }
          await prisma.$transaction(ops);
        },
      },
    },
    saveCreds: async () => {
      await write("creds", "creds", creds);
    },
  };
}

export async function clearAuthState(connectionId: string) {
  await prisma.whatsAppAuthKey.deleteMany({ where: { connectionId } });
}

export async function hasAuthState(connectionId: string) {
  return (await prisma.whatsAppAuthKey.count({ where: { connectionId, type: "creds" } })) > 0;
}
