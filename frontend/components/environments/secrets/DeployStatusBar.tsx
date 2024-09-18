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
    <div className={clsx(
      "flex items-center gap-2",
      "transition-all duration-300 ease-in-out",
      unsavedChanges ? [
        "w-full",
        "rounded-full shadow-lg px-2.5 py-2.5",
        "bg-white dark:bg-neutral-800"
      ] : "w-full",
      "mr-6"
    )}>
      {unsavedChanges ? (
        <>
          <div className="flex-grow">
            <DeployPreview
              clientSecrets={clientSecrets}
              serverSecrets={serverSecrets}
              secretsToDelete={secretsToDelete}
              onDiscard={onDiscard}
              isLoading={isLoading}
            />
          </div>
          <Button
            variant={unsavedChanges ? 'warning' : 'primary'}
            onClick={onDeploy}
            disabled={isLoading}
            isLoading={isLoading}
            className="whitespace-nowrap"
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
    </div>
  );
};

export default DeployStatusBar;
