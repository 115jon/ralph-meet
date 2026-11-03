# Code signing: reusing the Azure Artifact Signing account

One Basic Artifact Signing account signs Windows binaries for all of the
maintainer's projects. Basic is $9.99/month and includes 5,000 signatures a
month across every repo that uses it; each further signature costs $0.005. Every
file signed is one signature, so a Yap release uses about seven.

| Setting                              | Where                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Account                              | `jon115signing` (East US, Basic)                                        |
| Endpoint                             | `https://eus.codesigning.azure.net/`                                    |
| Certificate profile                  | `publictrust` (Public Trust, signer `Jonathan Martinez`)                |
| Tenant, subscription, resource group | the maintainer's private ops notes, and repo variable `AZURE_TENANT_ID` |

Basic allows one certificate profile of each type, so every repo signs with the
same `publictrust` profile and the same signer name. Do not create a second
account or profile per repo.

## Add a repo (`owner/repo`)

Give each repo its own Entra app, so access can be revoked per repo.

```powershell
$repo = "owner/repo"
$app = az ad app create --display-name "github-$($repo -replace '/','-')-artifact-signing" -o json | ConvertFrom-Json
$sp = az ad sp create --id $app.appId -o json | ConvertFrom-Json

# Trust the default branch (add one per branch or environment that signs).
@{ name = "main"; issuer = "https://token.actions.githubusercontent.com"
   subject = "repo:${repo}:ref:refs/heads/main"; audiences = @("api://AzureADTokenExchange") } |
  ConvertTo-Json | Set-Content fic.json
az ad app federated-credential create --id $app.id --parameters "@fic.json"

# Let it sign, and nothing else.
$account = az resource list --resource-type Microsoft.CodeSigning/codeSigningAccounts --name jon115signing --query "[0].id" -o tsv
az role assignment create --assignee-object-id $sp.id --assignee-principal-type ServicePrincipal `
  --role "Artifact Signing Certificate Profile Signer" --scope $account

gh variable set AZURE_CLIENT_ID -R $repo -b $app.appId
gh variable set AZURE_TENANT_ID -R $repo -b (az account show --query tenantId -o tsv)
gh variable set ARTIFACT_SIGNING_ACCOUNT -R $repo -b jon115signing
gh variable set ARTIFACT_SIGNING_PROFILE -R $repo -b publictrust
gh variable set ARTIFACT_SIGNING_ENDPOINT -R $repo -b https://eus.codesigning.azure.net/
```

To trust tags as well, Yap uses a flexible federated credential (Graph beta
`federatedIdentityCredentials` with `claimsMatchingExpression`). Entra requires
the immutable `repository_id` and `repository_owner_id` claims next to the `sub`
match:

```text
claims['sub'] matches 'repo:owner/repo:ref:refs/tags/v*' and claims['repository_id'] eq '<id>' and claims['repository_owner_id'] eq '<owner id>'
```

`gh api repos/owner/repo --jq '.id, .owner.id'` gives both IDs.

## Workflow

The job needs `id-token: write`, and so does any workflow that calls it as a
reusable workflow. The app has no subscription access, so log in with
`allow-no-subscriptions`.

```yaml
permissions:
  contents: read
  id-token: write
steps:
  - uses: azure/login@053f7285eb20bf5469ef084617b0b24d3cec53fc # v3.1.0
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      allow-no-subscriptions: true
  - uses: azure/artifact-signing-action@208f8af4bf26cf2af8597424e3cb5582801523ba # v2.0.0
    with:
      endpoint: ${{ vars.ARTIFACT_SIGNING_ENDPOINT }}
      signing-account-name: ${{ vars.ARTIFACT_SIGNING_ACCOUNT }}
      certificate-profile-name: ${{ vars.ARTIFACT_SIGNING_PROFILE }}
      files: |
        ${{ github.workspace }}\dist\MyApp.exe
      file-digest: SHA256
      timestamp-rfc3161: http://timestamp.acs.microsoft.com
      timestamp-digest: SHA256
```

Then check the result with `signtool verify /pa`, or copy
`desktop/scripts/verify-authenticode.ps1` from this repo. Sign before any step
that hashes or signs the final bytes (installers that embed the file, updater
signatures, checksums), and never re-sign third-party files that must keep
their vendor's signature.
