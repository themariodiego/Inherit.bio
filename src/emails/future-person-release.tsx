import { Button,Text } from "@react-email/components";
import { EmailLayout,brand } from "./base";
export interface FuturePersonReleaseProps { releaseUrl:string }
export function FuturePersonReleaseEmail({releaseUrl}:FuturePersonReleaseProps) {
  return <EmailLayout heading="Your request is ready">
    <Text style={{fontSize:"16px",lineHeight:"1.6",color:brand.inkMuted}}>
      Your claim has been approved. Open your private link to view your record
      and use your rights. You do not need an account.
    </Text>
    <Text style={{fontSize:"16px",lineHeight:"1.6",color:brand.inkMuted}}>
      This link expires in seven days and works once. If it expires, start a new
      claim with your Recovery Key, or with fresh identity documents if you do
      not have a key.
    </Text>
    <Button href={releaseUrl} style={{backgroundColor:brand.forest,color:brand.paper,
      padding:"14px 22px",borderRadius:"8px",textDecoration:"none",fontSize:"16px"}}>
      Open your link
    </Button>
  </EmailLayout>;
}
