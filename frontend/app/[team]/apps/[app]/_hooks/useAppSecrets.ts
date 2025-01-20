import { useEffect, useState, useCallback, useContext } from 'react';
import { useLazyQuery, useQuery } from '@apollo/client';
import { EnvironmentType } from '@/apollo/graphql';
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs, OrganisationKeyring } from '@/utils/crypto';
import { AppSecret, AppFolder, EnvSecrets, EnvFolders } from '../types';
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvSecretsKV } from '@/graphql/queries/secrets/getSecretKVs.gql'
import { KeyringContext } from '@/contexts/keyringContext';

export const useAppSecrets = (appId: string, allowFetch: boolean, pollInterval: number = 10000) => {
  const [appSecrets, setAppSecrets] = useState<AppSecret[]>([]);
  const [appFolders, setAppFolders] = useState<AppFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const { keyring } = useContext(KeyringContext)

  const [getEnvSecrets] = useLazyQuery(GetEnvSecretsKV)

  const { data, refetch } = useQuery(GetAppEnvironments, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
    skip: !allowFetch,
    pollInterval, // Automatically refetch data at the specified interval
  });

  const processAppSecrets = useCallback(async (appEnvironments: EnvironmentType[]) => {
    const envSecrets: EnvSecrets[] = [];
    const envFolders: EnvFolders[] = [];

    for (const env of appEnvironments) {
      const { data } = await getEnvSecrets({
        variables: { envId: env.id },
        fetchPolicy: 'cache-and-network',
      });

      const { wrappedSeed, wrappedSalt } = data.environmentKeys[0];
      const { publicKey, privateKey } = await unwrapEnvSecretsForUser(wrappedSeed, wrappedSalt, keyring!);
      const decryptedSecrets = await decryptEnvSecretKVs(data.secrets, { publicKey, privateKey });

      envSecrets.push({ env, secrets: decryptedSecrets });
      envFolders.push({ env, folders: data.folders });
    }

    const secretKeys = Array.from(new Set(envSecrets.flatMap((envCard) => envCard.secrets.map((secret) => secret.key))));
    const folderNames = Array.from(new Set(envFolders.flatMap((envCard) => envCard.folders.map((folder) => folder.name))));

    const appSecrets = secretKeys.map((key) => {
      const envs = envSecrets.map((envCard) => ({
        env: envCard.env,
        secret: envCard.secrets.find((secret) => secret.key === key) || null,
      }));
      const id = envs.map((env) => env.secret?.id).join('|');
      return { id, key, envs };
    });

    const appFolders = folderNames.map((name) => {
      const envs = envFolders.map((envCard) => ({
        env: envCard.env,
        folder: envCard.folders.find((folder) => folder.name === name) || null,
      }));
      return { name, envs };
    });

    setAppSecrets(appSecrets);
    setAppFolders(appFolders);
    setLoading(false);
  }, [keyring]);

  useEffect(() => {
    if (keyring && data?.appEnvironments && allowFetch) {
      setLoading(true);
      processAppSecrets(data.appEnvironments);
    }
  }, [data?.appEnvironments, keyring, processAppSecrets]);

  return { appEnvironments: data?.appEnvironments, appSecrets, appFolders, fetching: loading, refetch };
};
