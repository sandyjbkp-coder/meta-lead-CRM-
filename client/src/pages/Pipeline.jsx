import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import api from '../lib/api';

const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

export default function Pipeline() {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data } = await api.get('/leads');
      return data.leads || [];
    },
  });

  const [pipelineLeads, setPipelineLeads] = useState({});n

  useEffect(() => {
    const grouped = {};
    STATUSES.forEach(status => {
      grouped[status] = leads.filter(lead => lead.status === status);
    });
    setPipelineLeads(grouped);
  }, [leads]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (!over) return;
    if (active.id === over.id) return;

    const sourceStatus = Object.keys(pipelineLeads).find(
      status => pipelineLeads[status].some(lead => lead.id === active.id)
    );
    const destStatus = over.id;

    if (sourceStatus === destStatus) return;

    try {
      await api.patch(`/leads/${active.id}`, { status: destStatus });
      setPipelineLeads(prev => {
        const newState = { ...prev };
        const sourceLeads = newState[sourceStatus];
        const destLeads = newState[destStatus];
        const movedLead = sourceLeads.find(lead => lead.id === active.id);

        newState[sourceStatus] = sourceLeads.filter(lead => lead.id !== active.id);
        newState[destStatus] = [...destLeads, movedLead];
        return newState;
      });
    } catch (error) {
      console.error('Failed to update lead status:', error);
    }
  };

  if (isLoading) return <div>Loading pipeline...</div>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Pipeline</h1>
      <div className="overflow-x-auto">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 min-w-max">
            {STATUSES.map(status => (
              <div key={status} className="w-64 flex-shrink-0">
                <h3 className="font-semibold text-lg mb-2 capitalize border-b pb-2">
                  {status} ({pipelineLeads[status]?.length || 0})
                </h3>
                <Droppable droppableId={status}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="bg-gray-50 rounded-lg p-3 min-h-[200px] border-2 border-dashed border-gray-200"
                    >
                      {pipelineLeads[status]?.length === 0 ? (
                        <p className="text-gray-400 text-center mt-8">Drop here</p>
                      ) : (
                        pipelineLeads[status]?.map((lead, index) => (
                          <Draggable key={lead.id} draggableId={lead.id.toString()} index={index}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className="bg-white border rounded-lg p-3 mb-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="font-medium text-sm truncate max-w-[150px]">{lead.full_name}</h4>
                                  <GripVertical size={16} className="text-gray-400" {...provided.dragHandleProps} />
                                </div>
                                <p className="text-xs text-gray-600 truncate mb-1">{lead.email}</p>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs text-gray-500">{lead.phone}</span>
                                  <span className="text-xs text-gray-400">
                                    {lead.assigned_to_name || `ID: ${lead.id}`}
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  );
}
