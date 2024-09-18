import React from 'react';
import { Button } from '@/components/common/Button';
import { FaCheckCircle } from 'react-icons/fa';
import { DeployPreview } from '@/components/environments/secrets/DeployPreview';
import clsx from 'clsx';

interface DeployStatusBarProps {
  unsavedChanges: boolean;
  isLoading: boolean;
  onDiscard: () => void;
  onDeploy: () => void;
  clientSecrets: any[];
  serverSecrets: any[];
  secretsToDelete: string[];
}

const DeployStatusBar: React.FC<DeployStatusBarProps> = ({
  unsavedChanges,
  isLoading,
  onDiscard,
  onDeploy,
  clientSecrets,
  serverSecrets,
  secretsToDelete,
}) => {
  return (
    <>
      {unsavedChanges ? (
        <>
          <DeployPreview
            clientSecrets={clientSecrets}
            serverSecrets={serverSecrets}
            secretsToDelete={secretsToDelete}
            onDiscard={onDiscard}
            isLoading={isLoading}
          />
          <Button
            variant="warning"
            onClick={onDeploy}
            disabled={isLoading}
            isLoading={isLoading}
            className={clsx(
              "whitespace-nowrap",
              "transition-all duration-300 ease-in-out"
            )}
          >
            {isLoading ? 'Deploying...' : 'Deploy changes'}
          </Button>
        </>
      ) : (
        <div className={clsx(
          "flex items-center gap-2",
          "rounded-full py-1 px-3",
          "text-emerald-500",
          "ring-1 ring-inset ring-emerald-500/20",
          "transition-all duration-300 ease-in-out",
        )}>
          <FaCheckCircle className="shrink-0" />
          <span>Deployed</span>
        </div>
      )}
    </>
  );
};

export default DeployStatusBar;
