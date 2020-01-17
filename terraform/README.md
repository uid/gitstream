
To use this Terraform script, you will need to place the following deployment-specific files in this folder:

terraform.tfvars
: see ./terraform.tfvars.template; variables for terraform.tf script, e.g. OpenStack username/password and ssh private key for the Caesar VM

settings_local.py
: see ../settings_local.py.template; Django settings file with e.g. Caesar database location and password

krb5.keytab
: Kerberos host key for caesar.csail.mit.edu, so that Caesar can have permission to the 6.031 Athena AFS locker to load code from

didit-privatekey.pem
: private key for communicating with Didit
