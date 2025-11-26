import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useIpc } from "../contexts/ipc-context";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const ipc = useIpc();

  const handleUnderstood = () => {
    // Mark app as initialized when user dismisses the modal
    ipc.invokeSetAppInitialized();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-[400px] w-[400px]"
        showCloseButton={false}
      >
        <DialogHeader className="text-left">
          <DialogTitle>BreakTimer runs in the background</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-balance pt-2">
            The app can be accessed via your system tray.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleUnderstood} className="w-full">
            Understood, let&apos;s go!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
