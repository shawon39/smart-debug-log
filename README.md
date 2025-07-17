# Salesforce Debug Log Beautifier - Troubleshooting Guide

## Console Class Deployment Issues

If you're experiencing issues deploying the Console utility class to your Salesforce sandbox, follow this troubleshooting guide:

### Pre-Deployment Checklist

1. **Verify Salesforce Session**
   - Ensure you're logged into Salesforce in the same browser
   - Refresh the Salesforce tab if you've been idle for a while
   - Check that you're on a supported Salesforce domain (*.salesforce.com, *.force.com, etc.)

2. **Check Permissions**
   - Verify you have "Modify All Data" OR "Author Apex" permission
   - For sandbox environments, ensure your user profile allows Apex class creation
   - Contact your Salesforce admin if you're unsure about permissions

3. **Browser Console Testing**
   - Open the Debug Log Beautifier dashboard
   - Open browser Developer Tools (F12) → Console tab
   - Run: `testDeploymentSetup()`
   - This will verify your setup and report any issues

### Common Error Messages & Solutions

#### ❌ "No active Salesforce session found"
**Solution:** 
- Open a Salesforce tab in the same browser
- Log in to your Salesforce org/sandbox
- Refresh the extension dashboard

#### 🔒 "Session expired. Please refresh Salesforce and try again"
**Solution:**
- Go to your Salesforce tab and refresh the page
- Log in again if prompted
- Return to the extension and try deployment again

#### 🚫 "Insufficient permissions"
**Solution:**
- Contact your Salesforce administrator
- Request "Author Apex" or "Modify All Data" permission
- For sandboxes, ensure your profile/permission set allows Apex development

#### ⚠️ "Console class already exists in your org"
**Solution:**
- The class is already deployed! You can start using it
- If you need to update it, delete the existing class first in Setup → Apex Classes

#### 📋 "Please open a Salesforce tab in your browser"
**Solution:**
- Navigate to your Salesforce org in a new tab
- Ensure the URL contains one of: salesforce.com, force.com, lightning.force.com
- Keep both the Salesforce tab and extension open

### Sandbox-Specific Issues

#### For Developer Sandboxes:
- Ensure your sandbox is active and not expired
- Check that the sandbox has API access enabled
- Verify the sandbox supports the Tooling API

#### For Partial/Full Sandboxes:
- Same requirements as Developer sandboxes
- Ensure metadata deployment is allowed

### Manual Verification Steps

1. **Test API Access:**
   ```javascript
   // In browser console on extension dashboard:
   testDeploymentSetup()
   ```

2. **Check Console Class Manually:**
   - Go to Setup → Apex Classes in your Salesforce org
   - Search for "Console"
   - If it exists, deployment was successful

3. **Test the Console Class:**
   ```apex
   // In Developer Console or Apex Anonymous:
   List<Account> accounts = [SELECT Id, Name FROM Account LIMIT 3];
   Console.log('Test accounts', accounts);
   Console.log(accounts);
   Console.log('Simple message test');
   ```

### Advanced Troubleshooting

#### "TracedEntityId = 'undefined'" Error (Debug Infrastructure)
**Problem:** The extension can't extract your Salesforce User ID for debug logging setup.

**Solutions:**
1. **Test User ID Extraction:**
   ```javascript
   // In browser console on extension dashboard:
   debugUserIdExtraction()
   ```

2. **Manual User ID Setup:**
   - Go to Setup → Users → View your user profile
   - Copy your User ID (15-18 character string starting with "005")
   - In browser console: `currentSession.userId = "YOUR_USER_ID_HERE"`

3. **Refresh Salesforce Context:**
   - Navigate to a different Salesforce page (Setup, Object Manager, etc.)
   - Return to the extension dashboard
   - Try deployment again

#### Enable Debug Logging:
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Attempt deployment
4. Check for detailed error messages
5. Look for network errors or API responses

#### Check Network Issues:
- Verify your network allows API calls to *.salesforce.com
- Check if corporate firewall blocks API requests
- Try from a different network if possible

#### API Version Compatibility:
The extension uses Salesforce API version v62.0 for all operations including:
- Tooling API queries and deployments
- Debug log retrieval
- User information queries

### Still Having Issues?

1. **Check Browser Console** for detailed error messages
2. **Verify Org Type** - Some restrictions may apply to certain org types
3. **Contact Admin** if permission issues persist
4. **Try Different Browser** to rule out browser-specific issues

### Success Indicators

✅ **Deployment Successful:**
- Alert shows "Class is deployed"
- Button temporarily shows "Deployed ✓"
- Console class appears in Setup → Apex Classes

✅ **Ready to Use:**
```apex
// You can now use these methods in your Apex code:
Console.log(myObject);
Console.log('Label', myObject);
Console.log('Simple string message');
``` 