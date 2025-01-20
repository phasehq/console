import { useEffect, useState, useCallback, useContext } from 'react';
import { useLazyQuery, useQuery } from '@apollo/client';
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs } from '@/utils/crypto';
import { AppSecret, AppFolder, EnvFolders, EnvSecrets } from '../types';
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql';
import { GetEnvSecretsKV } from '@/graphql/queries/secrets/getSecretKVs.gql';
import { KeyringContext } from '@/contexts/keyringContext';
import { EnvironmentType, SecretType } from '@/apollo/graphql';

export const useAppSecrets = (appId: string, allowFetch: boolean, pollInterval: number = 10000) => {
  const [appSecrets, setAppSecrets] = useState<AppSecret[]>([]);
  const [appFolders, setAppFolders] = useState<AppFolder[]>([]);
  const [fetching, setFetching] = useState(true);

  const { keyring } = useContext(KeyringContext);

  const [getEnvSecrets] = useLazyQuery(GetEnvSecretsKV, {
    fetchPolicy: 'network-only',
  });

  const { data, refetch } = useQuery(GetAppEnvironments, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
    skip: !allowFetch,
    pollInterval,
  });

  const processAppSecrets = useCallback(
    async (appEnvironments: EnvironmentType[]) => {
      const envSecrets: EnvSecrets[] = [];
      const envFolders: EnvFolders[] = [];
  
      for (const env of appEnvironments) {
        const { data } = await getEnvSecrets({ variables: { envId: env.id } });
        const { wrappedSeed, wrappedSalt } = data.environmentKeys[0];
        const { publicKey, privateKey } = await unwrapEnvSecretsForUser(wrappedSeed, wrappedSalt, keyring!);
        const decryptedSecrets = await decryptEnvSecretKVs(data.secrets, { publicKey, privateKey });
  
        envSecrets.push({ env, secrets: decryptedSecrets });
        envFolders.push({ env, folders: data.folders });
      }
  
      const appSecrets = Array.from(new Set(envSecrets.flatMap(env => env.secrets.map(secret => secret.key)))).map(key => {
        const envs = envSecrets.map(env => ({
          env: env.env,
          secret: env.secrets.find(secret => secret.key === key) || null,
        }));
  
        // Generate a unique id by combining the appId and key
        const id = `${appId}-${key}`;
  
        return { id, key, envs };
      });
  
      const appFolders = Array.from(new Set(envFolders.flatMap(env => env.folders.map(folder => folder.name)))).map(name => ({
        name,
        envs: envFolders.map(env => ({
          env: env.env,
          folder: env.folders.find(folder => folder.name === name) || null,
        })),
      }));
  
      setAppSecrets(appSecrets);
      setAppFolders(appFolders);
      setFetching(false);
    },
    [getEnvSecrets, keyring, appId]
  );
  

  useEffect(() => {
    if (keyring && data?.appEnvironments && allowFetch) {
      setFetching(true);
      processAppSecrets(data.appEnvironments);
    }
  }, [data?.appEnvironments, keyring, allowFetch, processAppSecrets]);

  // Explicitly handle refetch
  const handleRefetch = async () => {
    setFetching(true);
    const { data: refetchedData } = await refetch();
    if (refetchedData?.appEnvironments) {
      await processAppSecrets(refetchedData.appEnvironments);
    }
  };

  return { appEnvironments: data?.appEnvironments, appSecrets, appFolders, fetching, refetch: handleRefetch };
};
