from django.shortcuts import render  
from rest_framework.views import APIView  
from rest_framework.response import Response  
from rest_framework import status
from rest_framework import permissions  
from .models import AwsAccount, AwsCloudtrailTrailEvent
from .serializers import AwsAccountSerializer, AwsCloudtrailTrailEventSerializer
# Create your views here.  
  
class AwsAccountView(APIView): 
    permission_classes = [permissions.IsAuthenticatedOrReadOnly] 
  
    def get(self, request, *args, **kwargs):  
        result = AwsAccount.objects.all()  
        serializers = AwsAccountSerializer(result, many=True)
        
        return Response({'status': 'success', "aws_account":serializers.data}, status=200)
    
class AwsCloudtrailTrailEventView(APIView): 
    permission_classes = [permissions.IsAuthenticatedOrReadOnly] 
  
    def get(self, request, *args, **kwargs):
        log_group_name = self.request.query_params.get('log_group_name')  
        result = AwsCloudtrailTrailEvent.objects.filter(log_group_name=log_group_name)
        serializers = AwsCloudtrailTrailEventSerializer(result, many=True)
        
        return Response({'status': 'success', "aws_cloudtrail_trail_event":serializers.data}, status=200)  