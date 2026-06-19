import { commonStyles, commonFooter } from './styles';

export const reviewCommunicatedTemplate = (
  name: string,
  manuscriptTitle: string,
  loginUrl: string,
  allowRevision: boolean
): string => `
<html>
<head><style type="text/css">${commonStyles}</style></head>
<body>
  <div class="header"><h1>Review Available for Your Manuscript</h1></div>
  <div class="content">
    <p>Dear ${name},</p>
    <p>The review for your manuscript has been completed:</p>
    <div class="proposal-title">"${manuscriptTitle}"</div>
    ${
      allowRevision
        ? `<p>Please log in to your dashboard to view the reviewer comments and submit a revised version of your manuscript.</p>`
        : `<p>Please log in to your dashboard to view the reviewer comments. A final decision will be communicated separately.</p>`
    }
    <a href="${loginUrl}" class="button">View Review</a>
  </div>
  ${commonFooter}
</body>
</html>
`;
