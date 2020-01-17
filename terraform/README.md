
To use this Terraform script, you will need to place the following deployment-specific files in this folder:

terraform.tfvars
: see ./terraform.tfvars.template; variables for terraform.tf script, e.g. OpenStack username/password and ssh private key for the OpenStack VM

gitstream_csail_mit_edu_cert.cer
: public cert for SSL

gitstream.csail.mit.edu.key
: private key for SSL

../gitstream.pem
: private key for communicating with Omnivore
