import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useLeads(filters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.status) params.set('status', filters.status);
      if (filters.campaign) params.set('campaign', filters.campaign);
      if (filters.assignee) params.set('assignee', filters.assignee);
      if (filters.page) params.set('page', filters.page);
      if (filters.limit) params.set('limit', filters.limit);

      const { data } = await api.get(`/leads?${params.toString()}`);
      return data;
    },
  });
}

export function useLead(id) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data } = await api.get(`/leads/${id}`);
      return data;
    },
  });
}

export function useLeadActivities(id) {
  return useQuery({
    queryKey: ['lead-activities', id],
    queryFn: async () => {
      const { data } = await api.get(`/leads/${id}/activities`);
      return data.activities;
    },
  });
}
